package syncsvc

import (
	"context"
	"errors"
	"net/url"

	"github.com/ComeHereToSee/typoza-backend/sdk/account"
	"github.com/ComeHereToSee/typoza-backend/sdk/api"
	"github.com/ComeHereToSee/typoza-client/helper/internal/rpc"
)

// appErr 构造给网页的业务错误:code 供界面分支(如 totp_required 时显示验证码输入框),message 直接展示。
func appErr(code, message string) *rpc.Error {
	return &rpc.Error{Code: rpc.CodeApp, Message: message, Data: map[string]string{"code": code}}
}

// friendly 是协议错误码对应的中文提示;没有列出的用服务器给的说明。
var friendly = map[string]string{
	api.CodeUnauthorized:       "邮箱或主密码不对",
	api.CodeTOTPRequired:       "请输入两步验证码",
	api.CodeTOTPInvalid:        "两步验证码不对",
	api.CodeEmailTaken:         "这个邮箱已经注册过,请直接登录",
	api.CodeRegistrationClosed: "这台服务器没有开放注册",
	api.CodeRateLimited:        "操作太频繁,请稍后再试",
	api.CodeQuotaExceeded:      "云端空间已用完",
	api.CodeRefreshReuse:       "登录已失效,请重新登录",
}

// toRPC 把 sdk 返回的错误转成带错误码的 RPC 错误。
func toRPC(err error) error {
	var rpcErr *rpc.Error
	if errors.As(err, &rpcErr) {
		return rpcErr
	}
	var ae *api.Error
	switch {
	case errors.As(err, &ae):
		msg := friendly[ae.Code]
		if msg == "" {
			msg = ae.Message
		}
		if msg == "" {
			msg = err.Error()
		}
		return appErr(ae.Code, msg)
	case errors.Is(err, account.ErrEmptyEmail):
		return appErr("invalid_request", "请填写邮箱")
	case errors.Is(err, account.ErrEmptyPassword):
		return appErr("invalid_request", "请填写主密码")
	case errors.Is(err, api.ErrNotLoggedIn):
		return appErr("signed_out", "尚未登录云同步")
	case errors.Is(err, context.DeadlineExceeded):
		return appErr("timeout", "连接服务器超时")
	}
	var ue *url.Error
	if errors.As(err, &ue) {
		return appErr("network", "连不上服务器:"+ue.Err.Error())
	}
	return appErr("error", err.Error())
}
