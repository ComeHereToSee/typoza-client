// typoza-helper 是 Typoza 的辅助进程:由 macOS 外壳按需启动,经标准输入输出走 JSON-RPC,
// 负责云同步(加密、上传下载、冲突处理)。不开启同步时不会启动,不影响冷启动速度。
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/ComeHereToSee/typoza-client/helper/internal/rpc"
)

var version = "dev"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := rpc.NewServer(os.Stdout)
	srv.Handle("helper.version", func(ctx context.Context, params json.RawMessage) (any, error) {
		return map[string]string{"version": version}, nil
	})
	if err := srv.Serve(ctx, os.Stdin); err != nil {
		fmt.Fprintln(os.Stderr, "typoza-helper:", err)
		os.Exit(1)
	}
}
