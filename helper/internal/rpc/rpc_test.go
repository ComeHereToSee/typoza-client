package rpc

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
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
