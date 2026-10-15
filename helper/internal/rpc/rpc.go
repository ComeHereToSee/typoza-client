// Package rpc 实现外壳与辅助进程之间的 JSON-RPC 2.0 通道:标准输入输出上每行一条 JSON 消息。
// 通道是双向的:外壳调用辅助进程的方法,辅助进程也可以反过来调用外壳(如把文件移进废纸篓)。
package rpc

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"sync"
	"sync/atomic"
)

// 标准 JSON-RPC 2.0 错误码。
const (
	CodeParseError     = -32700
	CodeInvalidRequest = -32600
	CodeMethodNotFound = -32601
	CodeInvalidParams  = -32602
	CodeInternal       = -32603
	// CodeApp 是业务错误(如密码错误、需要二次验证),具体原因放在 Data.code。
	CodeApp = -32000
)

// ErrClosed 表示对端已关闭管道,未完成的反向调用全部失败。
var ErrClosed = errors.New("rpc: 通道已关闭")

type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func (e *Error) Error() string { return fmt.Sprintf("rpc error %d: %s", e.Code, e.Message) }

// message 是通道上任意一条消息:有 method 的是请求或通知;没有 method、有 id 的是对本端请求的响应。
type message struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *Error          `json:"error,omitempty"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *Error          `json:"error,omitempty"`
}

type outgoing struct {
	JSONRPC string `json:"jsonrpc"`
	ID      string `json:"id,omitempty"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

// Handler 处理一个方法调用;返回 *Error 时原样回给调用方,其余 error 包成 CodeInternal。
type Handler func(ctx context.Context, params json.RawMessage) (any, error)

// Server 串行读取消息、并发执行处理器,写出时加锁保证每行完整。
type Server struct {
	handlers map[string]Handler
	mu       sync.Mutex
	w        *bufio.Writer

	seq     atomic.Int64
	pmu     sync.Mutex
	pending map[string]chan message
	closed  chan struct{}
	once    sync.Once
}

func NewServer(w io.Writer) *Server {
	return &Server{handlers: map[string]Handler{}, w: bufio.NewWriter(w), pending: map[string]chan message{}, closed: make(chan struct{})}
}

func (s *Server) Handle(method string, h Handler) { s.handlers[method] = h }

// Notify 向外壳推送事件(无 id 的消息),如同步进度。
func (s *Server) Notify(method string, params any) error {
	return s.write(outgoing{JSONRPC: "2.0", Method: method, Params: params})
}

// Call 反向调用外壳的方法并等待结果;out 为 nil 时丢弃结果。
func (s *Server) Call(ctx context.Context, method string, params, out any) error {
	// 本端发出的 id 一律带 h 前缀的字符串,与外壳自己的数字 id 区分开
	id := "h" + strconv.FormatInt(s.seq.Add(1), 10)
	ch := make(chan message, 1)
	s.pmu.Lock()
	s.pending[id] = ch
	s.pmu.Unlock()
	defer func() {
		s.pmu.Lock()
		delete(s.pending, id)
		s.pmu.Unlock()
	}()
	if err := s.write(outgoing{JSONRPC: "2.0", ID: id, Method: method, Params: params}); err != nil {
		return err
	}
	select {
	case m := <-ch:
		if m.Error != nil {
			return m.Error
		}
		if out != nil && len(m.Result) > 0 {
			if err := json.Unmarshal(m.Result, out); err != nil {
				return fmt.Errorf("rpc: 解析 %s 的结果: %w", method, err)
			}
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-s.closed:
		return ErrClosed
	}
}

func (s *Server) write(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("编码 RPC 消息失败: %w", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.w.Write(append(b, '\n')); err != nil {
		return fmt.Errorf("写 RPC 消息失败: %w", err)
	}
	return s.w.Flush()
}

// Serve 阻塞读取 r 直到 EOF(外壳关闭管道即退出),返回前等所有处理器结束。
func (s *Server) Serve(ctx context.Context, r io.Reader) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 1<<20), 64<<20)
	var wg sync.WaitGroup
	defer wg.Wait()
	defer s.once.Do(func() { close(s.closed) })
	for sc.Scan() {
		line := append([]byte(nil), sc.Bytes()...)
		var m message
		if err := json.Unmarshal(line, &m); err != nil {
			if werr := s.write(response{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &Error{Code: CodeParseError, Message: err.Error()}}); werr != nil {
				return werr
			}
			continue
		}
		if m.Method == "" {
			s.deliver(m)
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.dispatch(ctx, Request{JSONRPC: m.JSONRPC, ID: m.ID, Method: m.Method, Params: m.Params})
		}()
	}
	if err := sc.Err(); err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("读取 RPC 输入失败: %w", err)
	}
	return nil
}

// deliver 把外壳的响应交给等待中的 Call;找不到对应调用(已超时)就丢弃。
func (s *Server) deliver(m message) {
	id, err := strconv.Unquote(string(m.ID))
	if err != nil {
		return
	}
	s.pmu.Lock()
	ch := s.pending[id]
	s.pmu.Unlock()
	if ch != nil {
		select {
		case ch <- m:
		default: // 重复的响应:第一条已送达,其余丢弃
		}
	}
}

func (s *Server) dispatch(ctx context.Context, req Request) {
	isNotification := len(req.ID) == 0
	h, ok := s.handlers[req.Method]
	var resp response
	resp.JSONRPC = "2.0"
	resp.ID = req.ID
	if !ok {
		resp.Error = &Error{Code: CodeMethodNotFound, Message: "未知方法: " + req.Method}
	} else {
		result, err := h(ctx, req.Params)
		if err != nil {
			var rpcErr *Error
			if errors.As(err, &rpcErr) {
				resp.Error = rpcErr
			} else {
				resp.Error = &Error{Code: CodeInternal, Message: err.Error()}
			}
		} else {
			resp.Result = result
		}
	}
	if isNotification {
		return
	}
	_ = s.write(resp) // 写失败意味着外壳已关闭管道,Serve 随即在读端收到 EOF 退出
}
