// Package syncsvc 是辅助进程里的云同步服务:持有登录会话与各库的同步引擎,把 sdk 的账号、库、
// 历史、回收站能力包装成 RPC 方法,并把同步事件推给外壳。
//
// 密钥(刷新令牌与账户密钥)不落辅助进程的磁盘:外壳存进钥匙串,启动时经 session.resume 交回;
// 密钥每次变化(登录、令牌轮换、退出、登录失效)都推送 session.secrets,由外壳更新钥匙串。
package syncsvc

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/ComeHereToSee/typoza-backend/sdk/account"
	"github.com/ComeHereToSee/typoza-backend/sdk/api"
	"github.com/ComeHereToSee/typoza-backend/sdk/crypto"
	"github.com/ComeHereToSee/typoza-backend/sdk/engine"
)

// 通知方法名(辅助进程 → 外壳)。session.* 只给外壳,sync.* 由外壳转发给网页。
const (
	NotifySecrets = "session.secrets"
	NotifyStatus  = "sync.status"
	NotifyEvent   = "sync.event"
)

// minPasswordLen 是注册与改密时主密码的最短长度:主密码是端到端加密的根,太短可被离线爆破。
const minPasswordLen = 8

// maxPreviewBytes 是历史版本预览的读取上限。
const maxPreviewBytes = 16 << 20

// Host 是外壳一侧的能力。
type Host interface {
	// Notify 推送通知(无需回执)。
	Notify(method string, params any) error
	// Trash 把文件移进系统废纸篓(引擎处理「远端已删除」时调用)。
	Trash(ctx context.Context, absPath string) error
}

// Options 是 Service 的构造参数。
type Options struct {
	// DataDir 存放 config.json 与各库的状态目录(vaults/<id>)。
	DataDir string
	// DeviceName 显示在设备列表与冲突副本文件名里。
	DeviceName string
	Host       Host
	// HTTPClient 可选,测试里替换。
	HTTPClient *http.Client
	Logger     *slog.Logger
}

// Service 是云同步服务。方法可并发调用。
type Service struct {
	opts Options
	log  *slog.Logger
	ctx  context.Context
	stop context.CancelFunc

	// opMu 串行化会改变会话或库关联的操作(登录、退出、关联、解除关联、会话失效)。
	opMu sync.Mutex

	// mu 保护以下字段;持有 mu 时只允许调用 engine.Status(),不调用其它引擎方法。
	mu        sync.Mutex
	cfg       config
	client    *api.Client
	keys      *crypto.Keys
	secrets   *Secrets
	authError string
	runners   map[string]*runner
}

type runner struct {
	eng *engine.Engine
	err string // 引擎没能启动的原因(如文件夹不存在)
}

// New 读取配置;不联网、不启动引擎(等外壳经 session.resume 交回密钥)。
func New(opts Options) (*Service, error) {
	if opts.DataDir == "" || !filepath.IsAbs(opts.DataDir) {
		return nil, fmt.Errorf("数据目录 %q 必须是绝对路径", opts.DataDir)
	}
	if opts.DeviceName == "" {
		opts.DeviceName = "Mac"
	}
	if opts.Logger == nil {
		opts.Logger = slog.New(slog.NewTextHandler(os.Stderr, nil))
	}
	cfg, err := loadConfig(filepath.Join(opts.DataDir, "config.json"))
	if err != nil {
		return nil, err
	}
	ctx, stop := context.WithCancel(context.Background())
	return &Service{opts: opts, log: opts.Logger, ctx: ctx, stop: stop, cfg: cfg, runners: map[string]*runner{}}, nil
}

// Close 停止全部引擎。
func (s *Service) Close() {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	s.stopRunners()
	s.stop()
}

func (s *Service) device() api.Device {
	return api.Device{Name: s.opts.DeviceName, Platform: "macos"}
}

func (s *Service) configPath() string { return filepath.Join(s.opts.DataDir, "config.json") }

func (s *Service) stateDir(vaultID string) string {
	return filepath.Join(s.opts.DataDir, "vaults", vaultID)
}

// ---------- 状态 ----------

// Status 是推给网页的同步状态。
type Status struct {
	SignedIn   bool          `json:"signedIn"`
	Server     string        `json:"server"`
	Email      string        `json:"email"`
	DeviceName string        `json:"deviceName"`
	AuthError  string        `json:"authError,omitempty"`
	Vaults     []VaultStatus `json:"vaults"`
}

// VaultStatus 是一个已关联文件夹的状态。
type VaultStatus struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Root          string     `json:"root"`
	Active        bool       `json:"active"`
	Syncing       bool       `json:"syncing"`
	LastSyncAt    *time.Time `json:"lastSyncAt,omitempty"`
	LastSuccessAt *time.Time `json:"lastSuccessAt,omitempty"`
	LastError     string     `json:"lastError,omitempty"`
}

func timePtr(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

// Status 返回当前状态快照。
func (s *Service) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := Status{SignedIn: s.client != nil, Server: s.cfg.Server, Email: s.cfg.Email, DeviceName: s.opts.DeviceName, AuthError: s.authError, Vaults: []VaultStatus{}}
	for _, l := range s.cfg.Vaults {
		vs := VaultStatus{ID: l.ID, Name: l.Name, Root: l.Root}
		if r := s.runners[l.ID]; r != nil {
			if r.eng != nil {
				es := r.eng.Status()
				vs.Active, vs.Syncing = true, es.Syncing
				vs.LastSyncAt, vs.LastSuccessAt = timePtr(es.LastSyncAt), timePtr(es.LastSuccessAt)
				if es.LastError != nil {
					vs.LastError = es.LastError.Error()
				}
			} else {
				vs.LastError = r.err
			}
		}
		st.Vaults = append(st.Vaults, vs)
	}
	return st
}

func (s *Service) notifyStatus() {
	if err := s.opts.Host.Notify(NotifyStatus, s.Status()); err != nil {
		s.log.Warn("推送同步状态失败", "err", err)
	}
}

func (s *Service) notifySecrets(sec *Secrets) {
	if err := s.opts.Host.Notify(NotifySecrets, map[string]any{"secrets": sec}); err != nil {
		s.log.Error("推送会话密钥失败,钥匙串可能没更新", "err", err)
	}
}

// ---------- 会话 ----------

// newClient 构造 api 客户端;令牌轮换时只认当前会话的客户端,把新令牌推给外壳写钥匙串。
func (s *Service) newClient(server string) (*api.Client, error) {
	var c *api.Client
	c, err := api.New(api.Options{BaseURL: server, HTTPClient: s.opts.HTTPClient, OnTokens: func(t api.TokenPair) { s.onTokens(c, t) }})
	if err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Service) onTokens(c *api.Client, t api.TokenPair) {
	s.mu.Lock()
	if s.client != c || s.secrets == nil || t.RefreshToken == "" {
		s.mu.Unlock()
		return
	}
	s.secrets.AccessToken, s.secrets.RefreshToken = t.AccessToken, t.RefreshToken
	sec := *s.secrets
	s.mu.Unlock()
	s.notifySecrets(&sec)
}

// adopt 接管新登录的会话:换掉客户端与密钥、写配置、推送密钥、启动该账号已关联的库。需持有 opMu。
func (s *Service) adopt(server, email string, sess *account.Session, c *api.Client) error {
	tok := c.Tokens()
	sec := &Secrets{
		Server: server, Email: account.NormalizeEmail(email), UserID: sess.UserID, DeviceID: sess.DeviceID,
		AccountKey: append([]byte(nil), sess.Keys.Account[:]...), AccessToken: tok.AccessToken, RefreshToken: tok.RefreshToken,
	}
	return s.activate(sec, c, sess.Keys)
}

func (s *Service) activate(sec *Secrets, c *api.Client, keys *crypto.Keys) error {
	s.stopRunners()
	s.mu.Lock()
	cfg := s.cfg
	if cfg.UserID != sec.UserID || cfg.Server != sec.Server {
		// 换了账号或服务器:原来的关联属于别的账号,只清状态目录,不动本机文件
		for _, l := range cfg.Vaults {
			if err := os.RemoveAll(s.stateDir(l.ID)); err != nil {
				s.log.Warn("清理旧账号的库状态失败", "vault", l.ID, "err", err)
			}
		}
		cfg.Vaults = nil
	}
	cfg.Server, cfg.Email, cfg.UserID, cfg.DeviceID = sec.Server, sec.Email, sec.UserID, sec.DeviceID
	s.mu.Unlock()
	if err := saveConfig(s.configPath(), cfg); err != nil {
		return err
	}
	s.mu.Lock()
	s.cfg, s.client, s.keys, s.secrets, s.authError = cfg, c, keys, sec, ""
	s.mu.Unlock()
	copied := *sec
	s.notifySecrets(&copied)
	for _, l := range cfg.Vaults {
		s.startRunner(l)
	}
	s.notifyStatus()
	return nil
}

// endSession 停掉引擎、丢弃内存里的会话并通知外壳删除钥匙串条目;配置保留。需持有 opMu。
func (s *Service) endSession(reason string) {
	s.stopRunners()
	s.mu.Lock()
	had := s.client != nil
	s.client, s.keys, s.secrets, s.authError = nil, nil, nil, reason
	s.mu.Unlock()
	if had {
		s.notifySecrets(nil)
	}
	s.notifyStatus()
}

// sessionLost 在任何请求报告登录态失效时调用:多次调用只处理一次。
func (s *Service) sessionLost(c *api.Client) {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	s.mu.Lock()
	current := s.client != nil && s.client == c
	s.mu.Unlock()
	if !current {
		return
	}
	s.log.Warn("登录已失效,停止同步")
	s.endSession("登录已失效(可能在其他设备上修改了主密码或移除了本机),请重新登录")
}

// session 返回当前客户端与密钥;未登录时报错。
func (s *Service) session() (*api.Client, *crypto.Keys, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.client == nil {
		return nil, nil, appErr("signed_out", "尚未登录云同步")
	}
	return s.client, s.keys, nil
}

// check 把 sdk 错误转成给网页的错误;登录态失效时顺带结束会话。
func (s *Service) check(c *api.Client, err error) error {
	if err == nil {
		return nil
	}
	if api.IsAuthError(err) || errors.Is(err, api.ErrNotLoggedIn) {
		go s.sessionLost(c)
		return appErr("session_lost", "登录已失效,请重新登录")
	}
	return toRPC(err)
}

// ---------- 引擎 ----------

// startRunner 为已关联的库启动引擎;失败只记在状态里,不影响其它库。
func (s *Service) startRunner(l VaultLink) {
	s.mu.Lock()
	c, keys := s.client, s.keys
	s.mu.Unlock()
	r := &runner{}
	eng, err := engine.New(engine.Options{
		Root: l.Root, StateDir: s.stateDir(l.ID), VaultID: l.ID, Keys: keys, Client: c, DeviceName: s.opts.DeviceName,
		Trash: func(abs string) error {
			ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
			defer cancel()
			return s.opts.Host.Trash(ctx, abs)
		},
		OnEvent: func(ev engine.Event) { s.onEngineEvent(l, c, ev) },
	})
	if err == nil {
		if err = eng.Start(s.ctx); err != nil {
			_ = eng.Close()
		}
	}
	if err != nil {
		s.log.Warn("库同步没能启动", "vault", l.ID, "root", l.Root, "err", err)
		r.err = err.Error()
	} else {
		r.eng = eng
		s.log.Info("开始同步", "vault", l.ID, "root", l.Root)
	}
	s.mu.Lock()
	s.runners[l.ID] = r
	s.mu.Unlock()
}

// stopRunners 关闭全部引擎(等进行中的同步结束)。
func (s *Service) stopRunners() {
	s.mu.Lock()
	runners := s.runners
	s.runners = map[string]*runner{}
	s.mu.Unlock()
	for id, r := range runners {
		if r.eng != nil {
			if err := r.eng.Close(); err != nil {
				s.log.Warn("关闭同步引擎出错", "vault", id, "err", err)
			}
		}
	}
}

// Event 是推给网页的同步事件;路径同时给库内相对路径与本机绝对路径。
type Event struct {
	VaultID         string `json:"vaultId"`
	Kind            string `json:"kind"`
	Path            string `json:"path,omitempty"`
	AbsPath         string `json:"absPath,omitempty"`
	ConflictPath    string `json:"conflictPath,omitempty"`
	ConflictAbsPath string `json:"conflictAbsPath,omitempty"`
	Direction       string `json:"direction,omitempty"`
	Bytes           int64  `json:"bytes,omitempty"`
	Total           int64  `json:"total,omitempty"`
	Reason          string `json:"reason,omitempty"`
	Error           string `json:"error,omitempty"`
}

func (s *Service) onEngineEvent(l VaultLink, c *api.Client, ev engine.Event) {
	out := Event{VaultID: l.ID, Kind: string(ev.Kind), Path: ev.Path, ConflictPath: ev.ConflictPath, Direction: string(ev.Direction), Bytes: ev.Bytes, Total: ev.Total, Reason: ev.Reason}
	if ev.Path != "" {
		out.AbsPath = filepath.Join(l.Root, filepath.FromSlash(ev.Path))
	}
	if ev.ConflictPath != "" {
		out.ConflictAbsPath = filepath.Join(l.Root, filepath.FromSlash(ev.ConflictPath))
	}
	if ev.Err != nil {
		out.Error = ev.Err.Error()
		if api.IsAuthError(ev.Err) {
			go s.sessionLost(c)
		}
	}
	if err := s.opts.Host.Notify(NotifyEvent, out); err != nil {
		s.log.Warn("推送同步事件失败", "err", err)
	}
	if ev.Kind == engine.EventSyncStarted || ev.Kind == engine.EventSyncFinished {
		s.notifyStatus()
	}
}

// runnerFor 找到包含绝对路径 abs 的库;返回引擎与库内相对路径。
func (s *Service) runnerFor(abs string) (*engine.Engine, string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, l := range s.cfg.Vaults {
		if rel, ok := relIn(l.Root, filepath.Clean(abs)); ok {
			if r := s.runners[l.ID]; r != nil && r.eng != nil {
				return r.eng, rel, l.ID
			}
		}
	}
	return nil, "", ""
}

func (s *Service) runnerByID(id string) (*engine.Engine, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.runners[id]
	if r == nil || r.eng == nil {
		return nil, appErr("not_linked", "这个库没有在本机同步")
	}
	return r.eng, nil
}

// ---------- 账号操作 ----------

type credentials struct {
	Server   string `json:"server"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Service) requireSignedOut() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.client != nil {
		return appErr("signed_in", "已经登录,请先退出当前账号")
	}
	return nil
}

func (s *Service) register(ctx context.Context, p credentials) (any, error) {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	if err := s.requireSignedOut(); err != nil {
		return nil, err
	}
	if utf8.RuneCountInString(p.Password) < minPasswordLen {
		return nil, appErr("weak_password", fmt.Sprintf("主密码至少 %d 位", minPasswordLen))
	}
	server, err := normalizeServer(p.Server)
	if err != nil {
		return nil, appErr("invalid_server", err.Error())
	}
	c, err := s.newClient(server)
	if err != nil {
		return nil, toRPC(err)
	}
	reg, err := account.Register(ctx, c, p.Email, p.Password, s.device())
	if err != nil {
		return nil, toRPC(err)
	}
	if err := s.adopt(server, p.Email, &reg.Session, c); err != nil {
		return nil, err
	}
	s.log.Info("已注册并登录", "server", server)
	return map[string]any{"recoveryCode": reg.RecoveryCode, "status": s.Status()}, nil
}

type loginParams struct {
	credentials
	TOTP string `json:"totp"`
}

func (s *Service) login(ctx context.Context, p loginParams) (any, error) {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	if err := s.requireSignedOut(); err != nil {
		return nil, err
	}
	server, err := normalizeServer(p.Server)
	if err != nil {
		return nil, appErr("invalid_server", err.Error())
	}
	c, err := s.newClient(server)
	if err != nil {
		return nil, toRPC(err)
	}
	s.mu.Lock()
	deviceID := ""
	if s.cfg.Server == server && s.cfg.Email == account.NormalizeEmail(p.Email) {
		deviceID = s.cfg.DeviceID // 同一账号重新登录:沿用设备记录,设备列表里不会多出一台
	}
	s.mu.Unlock()
	sess, err := account.Login(ctx, c, p.Email, p.Password, account.LoginOptions{TOTPCode: p.TOTP, DeviceID: deviceID, Device: s.device()})
	if err != nil {
		return nil, toRPC(err)
	}
	if err := s.adopt(server, p.Email, sess, c); err != nil {
		return nil, err
	}
	s.log.Info("已登录", "server", server)
	return s.Status(), nil
}

type recoverParams struct {
	Server       string `json:"server"`
	Email        string `json:"email"`
	RecoveryCode string `json:"recoveryCode"`
	NewPassword  string `json:"newPassword"`
}

func (s *Service) recoverAccount(ctx context.Context, p recoverParams) (any, error) {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	if err := s.requireSignedOut(); err != nil {
		return nil, err
	}
	if utf8.RuneCountInString(p.NewPassword) < minPasswordLen {
		return nil, appErr("weak_password", fmt.Sprintf("主密码至少 %d 位", minPasswordLen))
	}
	server, err := normalizeServer(p.Server)
	if err != nil {
		return nil, appErr("invalid_server", err.Error())
	}
	c, err := s.newClient(server)
	if err != nil {
		return nil, toRPC(err)
	}
	sess, err := account.Recover(ctx, c, p.Email, p.RecoveryCode, p.NewPassword, s.device())
	if err != nil {
		return nil, toRPC(err)
	}
	if err := s.adopt(server, p.Email, sess, c); err != nil {
		return nil, err
	}
	return s.Status(), nil
}

type resumeParams struct {
	Secrets *Secrets `json:"secrets"`
}

// resume 用外壳从钥匙串取回的密钥恢复会话;不联网(离线也能打开并在联网后继续同步)。
func (s *Service) resume(_ context.Context, p resumeParams) (any, error) {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	sec := p.Secrets
	if sec == nil || sec.Server == "" || sec.UserID == "" || sec.RefreshToken == "" || len(sec.AccountKey) != 32 {
		return nil, appErr("invalid_secrets", "钥匙串里的会话信息不完整,请重新登录")
	}
	c, err := s.newClient(sec.Server)
	if err != nil {
		return nil, toRPC(err)
	}
	c.SetTokens(api.TokenPair{AccessToken: sec.AccessToken, RefreshToken: sec.RefreshToken})
	var ak crypto.AccountKey
	copy(ak[:], sec.AccountKey)
	if err := s.activate(sec, c, crypto.DeriveKeys(ak)); err != nil {
		return nil, err
	}
	return s.Status(), nil
}

func (s *Service) logout(ctx context.Context, _ struct{}) (any, error) {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	s.mu.Lock()
	c := s.client
	s.mu.Unlock()
	if c == nil {
		return s.Status(), nil
	}
	s.stopRunners()
	// 服务器不可达也照样在本机退出;令牌留在服务器端会按有效期自然失效
	if err := c.Logout(ctx); err != nil {
		s.log.Warn("通知服务器退出失败", "err", err)
	}
	s.endSession("")
	return s.Status(), nil
}

type changePasswordParams struct {
	OldPassword string `json:"oldPassword"`
	NewPassword string `json:"newPassword"`
}

func (s *Service) changePassword(ctx context.Context, p changePasswordParams) (any, error) {
	c, keys, err := s.session()
	if err != nil {
		return nil, err
	}
	if utf8.RuneCountInString(p.NewPassword) < minPasswordLen {
		return nil, appErr("weak_password", fmt.Sprintf("主密码至少 %d 位", minPasswordLen))
	}
	s.mu.Lock()
	email := s.cfg.Email
	s.mu.Unlock()
	if err := account.ChangePassword(ctx, c, email, p.OldPassword, p.NewPassword, keys); err != nil {
		// 旧密码错误与登录失效都是 401 unauthorized:再查一次账号区分两者
		if api.IsCode(err, api.CodeUnauthorized) {
			if _, probe := c.Account(ctx); probe == nil {
				return nil, appErr(api.CodeUnauthorized, "当前主密码不对")
			}
		}
		return nil, s.check(c, err)
	}
	return map[string]any{}, nil
}

func (s *Service) accountInfo(ctx context.Context, _ struct{}) (any, error) {
	c, _, err := s.session()
	if err != nil {
		return nil, err
	}
	a, err := c.Account(ctx)
	if err != nil {
		return nil, s.check(c, err)
	}
	return a, nil
}

type codeParams struct {
	Code string `json:"code"`
}

func (s *Service) totpSetup(ctx context.Context, _ struct{}) (any, error) {
	c, _, err := s.session()
	if err != nil {
		return nil, err
	}
	setup, err := account.SetupTOTP(ctx, c)
	if err != nil {
		return nil, s.check(c, err)
	}
	return setup, nil
}

func (s *Service) totpEnable(ctx context.Context, p codeParams) (any, error) {
	c, _, err := s.session()
	if err != nil {
		return nil, err
	}
	if err := account.EnableTOTP(ctx, c, p.Code); err != nil {
		return nil, s.check(c, err)
	}
	return map[string]any{}, nil
}

func (s *Service) totpDisable(ctx context.Context, p codeParams) (any, error) {
	c, _, err := s.session()
	if err != nil {
		return nil, err
	}
	if err := account.DisableTOTP(ctx, c, p.Code); err != nil {
		return nil, s.check(c, err)
	}
	return map[string]any{}, nil
}

func (s *Service) devices(ctx context.Context, _ struct{}) (any, error) {
	c, _, err := s.session()
	if err != nil {
		return nil, err
	}
	list, err := c.Devices(ctx)
	if err != nil {
		return nil, s.check(c, err)
	}
	if list == nil {
		list = []api.DeviceInfo{}
	}
	return list, nil
}

type idParams struct {
	ID string `json:"id"`
}

func (s *Service) revokeDevice(ctx context.Context, p idParams) (any, error) {
	c, _, err := s.session()
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	self := s.cfg.DeviceID
	s.mu.Unlock()
	if p.ID == self {
		return nil, appErr("self_device", "不能移除本机,请用「退出登录」")
	}
	if err := c.RevokeDevice(ctx, p.ID); err != nil {
		return nil, s.check(c, err)
	}
	return map[string]any{}, nil
}

// ---------- 库 ----------

// RemoteVault 是云端的一个库;Root 非空表示已关联到本机文件夹。
type RemoteVault struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	Root      string    `json:"root,omitempty"`
}

func (s *Service) remoteVaults(ctx context.Context, _ struct{}) (any, error) {
	c, keys, err := s.session()
	if err != nil {
		return nil, err
	}
	list, err := engine.ListVaults(ctx, c, keys)
	if err != nil {
		return nil, s.check(c, err)
	}
	s.mu.Lock()
	roots := map[string]string{}
	for _, l := range s.cfg.Vaults {
		roots[l.ID] = l.Root
	}
	s.mu.Unlock()
	out := make([]RemoteVault, 0, len(list))
	for _, v := range list {
		out = append(out, RemoteVault{ID: v.ID, Name: v.Name, CreatedAt: v.CreatedAt, Root: roots[v.ID]})
	}
	return out, nil
}

type linkParams struct {
	Root string `json:"root"`
	// VaultID 为空表示新建云端库,库名取 Name(为空时用文件夹名)。
	VaultID string `json:"vaultId"`
	Name    string `json:"name"`
}

func (s *Service) linkVault(ctx context.Context, p linkParams) (any, error) {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	c, keys, err := s.session()
	if err != nil {
		return nil, err
	}
	if !filepath.IsAbs(p.Root) {
		return nil, appErr("invalid_root", "请选择本机文件夹")
	}
	root := filepath.Clean(p.Root)
	if fi, err := os.Stat(root); err != nil || !fi.IsDir() {
		return nil, appErr("invalid_root", fmt.Sprintf("文件夹 %s 不存在", root))
	}
	if home, err := os.UserHomeDir(); err == nil && (root == filepath.Clean(home) || root == "/") {
		return nil, appErr("invalid_root", "不能同步整个用户目录或磁盘,请选一个笔记文件夹")
	}
	s.mu.Lock()
	for _, l := range s.cfg.Vaults {
		if overlaps(l.Root, root) {
			s.mu.Unlock()
			return nil, appErr("overlap", fmt.Sprintf("%s 与已同步的文件夹 %s 重叠", root, l.Root))
		}
		if p.VaultID != "" && l.ID == p.VaultID {
			s.mu.Unlock()
			return nil, appErr("already_linked", fmt.Sprintf("这个云端库已关联到 %s", l.Root))
		}
	}
	s.mu.Unlock()

	var link VaultLink
	if p.VaultID == "" {
		name := p.Name
		if name == "" {
			name = filepath.Base(root)
		}
		v, err := engine.CreateVault(ctx, c, keys, name)
		if err != nil {
			return nil, s.check(c, err)
		}
		link = VaultLink{ID: v.ID, Name: v.Name, Root: root}
	} else {
		list, err := engine.ListVaults(ctx, c, keys)
		if err != nil {
			return nil, s.check(c, err)
		}
		for _, v := range list {
			if v.ID == p.VaultID {
				link = VaultLink{ID: v.ID, Name: v.Name, Root: root}
			}
		}
		if link.ID == "" {
			return nil, appErr(api.CodeNotFound, "云端没有这个库")
		}
	}
	s.mu.Lock()
	cfg := s.cfg
	cfg.Vaults = append(append([]VaultLink(nil), cfg.Vaults...), link)
	s.mu.Unlock()
	if err := saveConfig(s.configPath(), cfg); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.cfg = cfg
	s.mu.Unlock()
	s.startRunner(link)
	s.notifyStatus()
	return s.Status(), nil
}

type vaultParams struct {
	VaultID string `json:"vaultId"`
}

// unlinkVault 解除关联:停止同步并删除本机状态;本机文件与云端数据都保留。
func (s *Service) unlinkVault(_ context.Context, p vaultParams) (any, error) {
	s.opMu.Lock()
	defer s.opMu.Unlock()
	s.mu.Lock()
	cfg := s.cfg
	cfg.Vaults = nil
	found := false
	for _, l := range s.cfg.Vaults {
		if l.ID == p.VaultID {
			found = true
			continue
		}
		cfg.Vaults = append(cfg.Vaults, l)
	}
	r := s.runners[p.VaultID]
	delete(s.runners, p.VaultID)
	s.mu.Unlock()
	if !found {
		return nil, appErr("not_linked", "这个库没有在本机同步")
	}
	if r != nil && r.eng != nil {
		if err := r.eng.Close(); err != nil {
			s.log.Warn("关闭同步引擎出错", "vault", p.VaultID, "err", err)
		}
	}
	if err := saveConfig(s.configPath(), cfg); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.cfg = cfg
	s.mu.Unlock()
	if err := os.RemoveAll(s.stateDir(p.VaultID)); err != nil {
		s.log.Warn("删除库状态目录失败", "vault", p.VaultID, "err", err)
	}
	s.notifyStatus()
	return s.Status(), nil
}

// syncNow 立即同步一个库(vaultId 为空时全部);返回同步后的状态。
func (s *Service) syncNow(ctx context.Context, p vaultParams) (any, error) {
	c, _, err := s.session()
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	var engines []*engine.Engine
	for id, r := range s.runners {
		if r.eng != nil && (p.VaultID == "" || id == p.VaultID) {
			engines = append(engines, r.eng)
		}
	}
	s.mu.Unlock()
	var errs []error
	for _, e := range engines {
		errs = append(errs, e.SyncNow(ctx))
	}
	if err := errors.Join(errs...); err != nil {
		return nil, s.check(c, err)
	}
	return s.Status(), nil
}

// ---------- 历史与回收站 ----------

type pathParams struct {
	Path string `json:"path"`
}

// Version 是云端历史版本。
type Version struct {
	Version    int64     `json:"version"`
	Size       int64     `json:"size"`
	MTime      time.Time `json:"mtime"`
	CreatedAt  time.Time `json:"createdAt"`
	Deleted    bool      `json:"deleted"`
	ThisDevice bool      `json:"thisDevice"`
}

// versions 列出本机文件在云端的历史版本;文件不在同步库里或还没同步过时返回 tracked=false。
func (s *Service) versions(ctx context.Context, p pathParams) (any, error) {
	c, _, err := s.session()
	if err != nil {
		return nil, err
	}
	eng, rel, vaultID := s.runnerFor(p.Path)
	empty := map[string]any{"tracked": false, "versions": []Version{}}
	if eng == nil {
		return empty, nil
	}
	list, err := eng.Versions(ctx, rel)
	if errors.Is(err, engine.ErrNotTracked) {
		return empty, nil
	}
	if err != nil {
		return nil, s.check(c, err)
	}
	s.mu.Lock()
	self := s.cfg.DeviceID
	s.mu.Unlock()
	out := make([]Version, 0, len(list))
	for _, v := range list {
		out = append(out, Version{Version: v.Version, Size: v.Size, MTime: v.MTime, CreatedAt: v.CreatedAt, Deleted: v.Deleted, ThisDevice: v.DeviceID == self})
	}
	return map[string]any{"tracked": true, "vaultId": vaultID, "versions": out}, nil
}

type readVersionParams struct {
	Path    string `json:"path"`
	Version int64  `json:"version"`
}

func (s *Service) readVersion(ctx context.Context, p readVersionParams) (any, error) {
	c, _, err := s.session()
	if err != nil {
		return nil, err
	}
	eng, rel, _ := s.runnerFor(p.Path)
	if eng == nil {
		return nil, appErr("not_linked", "这个文件不在同步文件夹里")
	}
	data, err := eng.ReadVersion(ctx, rel, p.Version, maxPreviewBytes)
	if errors.Is(err, engine.ErrTooLarge) {
		return nil, appErr("too_large", "这个版本太大,无法预览")
	}
	if err != nil {
		return nil, s.check(c, err)
	}
	if !utf8.Valid(data) {
		return nil, appErr("not_text", "这个版本不是文本,无法预览")
	}
	return map[string]any{"text": string(data)}, nil
}

// TrashItem 是云端回收站里的文件。
type TrashItem struct {
	FileID    string    `json:"fileId"`
	Path      string    `json:"path"`
	Version   int64     `json:"version"`
	DeletedAt time.Time `json:"deletedAt"`
}

func (s *Service) trash(ctx context.Context, p vaultParams) (any, error) {
	c, _, err := s.session()
	if err != nil {
		return nil, err
	}
	eng, err := s.runnerByID(p.VaultID)
	if err != nil {
		return nil, err
	}
	list, err := eng.Trash(ctx)
	if err != nil {
		return nil, s.check(c, err)
	}
	out := make([]TrashItem, 0, len(list))
	for _, t := range list {
		out = append(out, TrashItem{FileID: t.FileID, Path: t.Path, Version: t.Version, DeletedAt: t.DeletedAt})
	}
	return out, nil
}

type fileParams struct {
	VaultID string `json:"vaultId"`
	FileID  string `json:"fileId"`
}

func (s *Service) restoreTrash(ctx context.Context, p fileParams) (any, error) {
	c, _, err := s.session()
	if err != nil {
		return nil, err
	}
	eng, err := s.runnerByID(p.VaultID)
	if err != nil {
		return nil, err
	}
	if err := eng.RestoreFromTrash(ctx, p.FileID); err != nil {
		return nil, s.check(c, err)
	}
	return map[string]any{}, nil
}

func (s *Service) purge(ctx context.Context, p fileParams) (any, error) {
	c, _, err := s.session()
	if err != nil {
		return nil, err
	}
	eng, err := s.runnerByID(p.VaultID)
	if err != nil {
		return nil, err
	}
	if err := eng.Purge(ctx, p.FileID); err != nil {
		return nil, s.check(c, err)
	}
	return map[string]any{}, nil
}
