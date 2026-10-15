package syncsvc

import (
	"context"
	"encoding/json"

	"github.com/ComeHereToSee/typoza-client/helper/internal/rpc"
)

// bind 把强类型处理函数包成 rpc.Handler:参数解码失败返回 InvalidParams。
func bind[P any](fn func(context.Context, P) (any, error)) rpc.Handler {
	return func(ctx context.Context, raw json.RawMessage) (any, error) {
		var p P
		if len(raw) > 0 && string(raw) != "null" {
			if err := json.Unmarshal(raw, &p); err != nil {
				return nil, &rpc.Error{Code: rpc.CodeInvalidParams, Message: "参数格式不对: " + err.Error()}
			}
		}
		return fn(ctx, p)
	}
}

// Routes 返回全部 RPC 方法。session.resume 只给外壳用(参数含密钥),外壳不得把它转发给网页。
func (s *Service) Routes() map[string]rpc.Handler {
	return map[string]rpc.Handler{
		"session.resume": bind(s.resume),

		"sync.status":         bind(func(context.Context, struct{}) (any, error) { return s.Status(), nil }),
		"sync.register":       bind(s.register),
		"sync.login":          bind(s.login),
		"sync.recover":        bind(s.recoverAccount),
		"sync.logout":         bind(s.logout),
		"sync.changePassword": bind(s.changePassword),
		"sync.account":        bind(s.accountInfo),
		"sync.totpSetup":      bind(s.totpSetup),
		"sync.totpEnable":     bind(s.totpEnable),
		"sync.totpDisable":    bind(s.totpDisable),
		"sync.devices":        bind(s.devices),
		"sync.revokeDevice":   bind(s.revokeDevice),

		"sync.remoteVaults": bind(s.remoteVaults),
		"sync.linkVault":    bind(s.linkVault),
		"sync.unlinkVault":  bind(s.unlinkVault),
		"sync.now":          bind(s.syncNow),

		"sync.versions":     bind(s.versions),
		"sync.readVersion":  bind(s.readVersion),
		"sync.trash":        bind(s.trash),
		"sync.restoreTrash": bind(s.restoreTrash),
		"sync.purge":        bind(s.purge),
	}
}
