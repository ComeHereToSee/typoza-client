package rpc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"
)

func TestServeDispatchesAndReportsUnknownMethod(t *testing.T) {
	var out bytes.Buffer
	s := NewServer(&out)
	s.Handle("ping", func(ctx context.Context, params json.RawMessage) (any, error) {
		return map[string]string{"pong": "ok"}, nil
	})
	in := strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"ping"}` + "\n" +
		`{"jsonrpc":"2.0","id":2,"method":"nope"}` + "\n")
	if err := s.Serve(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	got := map[string]response{}
	for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		var r response
		if err := json.Unmarshal([]byte(line), &r); err != nil {
			t.Fatalf("输出不是合法 JSON: %q", line)
		}
		got[string(r.ID)] = r
	}
	if got["1"].Error != nil {
		t.Fatalf("ping 不应报错: %+v", got["1"].Error)
	}
	if got["2"].Error == nil || got["2"].Error.Code != CodeMethodNotFound {
		t.Fatalf("未知方法应返回 %d,实际 %+v", CodeMethodNotFound, got["2"].Error)
	}
}

func TestCallWaitsForShellResponse(t *testing.T) {
	ctx := context.Background()
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	s := NewServer(outW)
	done := make(chan error, 1)
	go func() { done <- s.Serve(ctx, inR) }()

	// 假外壳:读出辅助进程发来的请求,第一次回结果、第二次回错误,之后只读不答
	go func() {
		br := bufio.NewReader(outR)
		for n := 0; ; n++ {
			line, err := br.ReadBytes('\n')
			if err != nil {
				return
			}
			var req struct {
				ID     string            `json:"id"`
				Method string            `json:"method"`
				Params map[string]string `json:"params"`
			}
			if err := json.Unmarshal(line, &req); err != nil || req.ID == "" || req.Method != "host.trash" {
				t.Errorf("反向请求格式不对: %s", line)
				return
			}
			switch n {
			case 0:
				fmt.Fprintf(inW, `{"jsonrpc":"2.0","id":%q,"result":{"echo":%q}}`+"\n", req.ID, req.Params["path"])
			case 1:
				fmt.Fprintf(inW, `{"jsonrpc":"2.0","id":%q,"error":{"code":-32000,"message":"废纸篓不可用"}}`+"\n", req.ID)
			}
		}
	}()

	var res struct{ Echo string }
	if err := s.Call(ctx, "host.trash", map[string]string{"path": "/a.md"}, &res); err != nil || res.Echo != "/a.md" {
		t.Fatalf("Call 结果不对: %+v %v", res, err)
	}
	err := s.Call(ctx, "host.trash", map[string]string{"path": "/b.md"}, nil)
	var rpcErr *Error
	if !errors.As(err, &rpcErr) || rpcErr.Message != "废纸篓不可用" {
		t.Fatalf("应透出外壳的错误: %v", err)
	}
	// 第三次调用外壳不答;关闭输入后应以 ErrClosed 结束,而不是永久挂起
	errc := make(chan error, 1)
	go func() { errc <- s.Call(ctx, "host.trash", map[string]string{"path": "/c.md"}, nil) }()
	time.Sleep(50 * time.Millisecond)
	inW.Close()
	if err := <-errc; !errors.Is(err, ErrClosed) {
		t.Fatalf("管道关闭后应返回 ErrClosed: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	outW.Close()
}
