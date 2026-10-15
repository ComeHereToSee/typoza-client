// typoza-helper 是 Typoza 的辅助进程:由 macOS 外壳按需启动,经标准输入输出走 JSON-RPC,
// 负责云同步(加密、上传下载、冲突处理)。不开启同步时不会启动,不影响冷启动速度。
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/ComeHereToSee/typoza-client/helper/internal/rpc"
	"github.com/ComeHereToSee/typoza-client/helper/internal/syncsvc"
)

var version = "dev"

// shellHost 经 RPC 通道使用外壳的能力。
type shellHost struct{ srv *rpc.Server }

func (h shellHost) Notify(method string, params any) error { return h.srv.Notify(method, params) }

func (h shellHost) Trash(ctx context.Context, absPath string) error {
	return h.srv.Call(ctx, "host.trash", map[string]string{"path": absPath}, nil)
}

func main() {
	dataDir := flag.String("data-dir", "", "同步配置与状态目录(绝对路径)")
	deviceName := flag.String("device-name", "", "本机名称")
	flag.Parse()
	// 日志写标准错误,外壳把它转存到 ~/Library/Logs/Typoza/helper.log;标准输出只走 RPC
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := rpc.NewServer(os.Stdout)
	svc, err := syncsvc.New(syncsvc.Options{DataDir: *dataDir, DeviceName: *deviceName, Host: shellHost{srv}, Logger: log})
	if err != nil {
		fmt.Fprintln(os.Stderr, "typoza-helper:", err)
		os.Exit(2)
	}
	for method, h := range svc.Routes() {
		srv.Handle(method, h)
	}
	srv.Handle("helper.version", func(ctx context.Context, params json.RawMessage) (any, error) {
		return map[string]string{"version": version}, nil
	})
	log.Info("辅助进程已启动", "version", version, "pid", os.Getpid())
	// 正常退出是外壳关闭管道(EOF);收到信号时关掉标准输入让 Serve 返回,再停引擎
	go func() {
		<-ctx.Done()
		_ = os.Stdin.Close()
	}()
	serveErr := srv.Serve(ctx, os.Stdin)
	svc.Close()
	if serveErr != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, "typoza-helper:", serveErr)
		os.Exit(1)
	}
}
