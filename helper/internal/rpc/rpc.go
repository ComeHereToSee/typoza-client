// Package rpc 实现外壳与辅助进程之间的 JSON-RPC 2.0 通道:标准输入输出上每行一条 JSON 消息。
package rpc

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
)

// 标准 JSON-RPC 2.0 错误码。
const (
	CodeParseError     = -32700
	CodeInvalidRequest = -32600
	CodeMethodNotFound = -32601
	CodeInvalidParams  = -32602
	CodeInternal       = -32603
)

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

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *Error          `json:"error,omitempty"`
}

type notification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

// Handler 处理一个方法调用;返回 *Error 时原样回给调用方,其余 error 包成 CodeInternal。
type Handler func(ctx context.Context, params json.RawMessage) (any, error)

// Server 串行读取请求、并发执行处理器,写出时加锁保证每行完整。
type Server struct {
	handlers map[string]Handler
	mu       sync.Mutex
	w        *bufio.Writer
}

func NewServer(w io.Writer) *Server {
	return &Server{handlers: map[string]Handler{}, w: bufio.NewWriter(w)}
}

func (s *Server) Handle(method string, h Handler) { s.handlers[method] = h }

// Notify 向外壳推送事件(无 id 的消息),如同步进度。
func (s *Server) Notify(method string, params any) error {
	return s.write(notification{JSONRPC: "2.0", Method: method, Params: params})
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

// Serve 阻塞读取 r 直到 EOF(外壳关闭管道即退出)。
func (s *Server) Serve(ctx context.Context, r io.Reader) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 1<<20), 64<<20)
	var wg sync.WaitGroup
	defer wg.Wait()
	for sc.Scan() {
		line := append([]byte(nil), sc.Bytes()...)
		var req Request
		if err := json.Unmarshal(line, &req); err != nil {
			if werr := s.write(response{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &Error{Code: CodeParseError, Message: err.Error()}}); werr != nil {
				return werr
			}
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.dispatch(ctx, req)
		}()
	}
	if err := sc.Err(); err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("读取 RPC 输入失败: %w", err)
	}
	return nil
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
