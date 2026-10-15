package syncsvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/ComeHereToSee/typoza-backend/sdk/fakeserver"
	"github.com/ComeHereToSee/typoza-client/helper/internal/rpc"
)

// fakeHost 记录推给外壳的通知;Trash 把文件挪进测试自己的废纸篓目录。
type fakeHost struct {
	mu       sync.Mutex
	notes    []note
	trashDir string
	trashed  []string
}

type note struct {
	method string
	params json.RawMessage
}

func (h *fakeHost) Notify(method string, params any) error {
	b, err := json.Marshal(params)
	if err != nil {
		return err
	}
	h.mu.Lock()
	h.notes = append(h.notes, note{method, b})
	h.mu.Unlock()
	return nil
}

func (h *fakeHost) Trash(_ context.Context, abs string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.trashed = append(h.trashed, abs)
	return os.Rename(abs, filepath.Join(h.trashDir, fmt.Sprintf("%d-%s", len(h.trashed), filepath.Base(abs))))
}

func (h *fakeHost) trashedPaths() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.trashed...)
}

// lastSecrets 返回最近一次 session.secrets 通知;found=false 表示从没推送过。
func (h *fakeHost) lastSecrets() (sec *Secrets, found bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for i := len(h.notes) - 1; i >= 0; i-- {
		if h.notes[i].method == NotifySecrets {
			var p struct{ Secrets *Secrets }
			if err := json.Unmarshal(h.notes[i].params, &p); err != nil {
				panic(err)
			}
			return p.Secrets, true
		}
	}
	return nil, false
}

func (h *fakeHost) count(method string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, x := range h.notes {
		if x.method == method {
			n++
		}
	}
	return n
}

type device struct {
	svc     *Service
	host    *fakeHost
	dataDir string
	root    string
}

func newServer(t *testing.T) string {
	t.Helper()
	fs := fakeserver.New()
	srv := httptest.NewServer(fs.Handler())
	t.Cleanup(func() {
		fs.Close()
		srv.Close()
	})
	return srv.URL
}

func newDevice(t *testing.T, name string) *device {
	t.Helper()
	d := &device{host: &fakeHost{trashDir: t.TempDir()}, dataDir: t.TempDir(), root: t.TempDir()}
	d.open(t, name)
	return d
}

func (d *device) open(t *testing.T, name string) {
	t.Helper()
	svc, err := New(Options{DataDir: d.dataDir, DeviceName: name, Host: d.host, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	d.svc = svc
	t.Cleanup(svc.Close)
}

func invoke(s *Service, method string, params any) (json.RawMessage, error) {
	h := s.Routes()[method]
	if h == nil {
		return nil, fmt.Errorf("没有方法 %s", method)
	}
	raw, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	res, err := h(context.Background(), raw)
	if err != nil {
		return nil, err
	}
	return json.Marshal(res)
}

func (d *device) call(t *testing.T, method string, params any, out any) {
	t.Helper()
	b, err := invoke(d.svc, method, params)
	if err != nil {
		t.Fatalf("%s: %v", method, err)
	}
	if out != nil {
		if err := json.Unmarshal(b, out); err != nil {
			t.Fatalf("%s 的结果 %s: %v", method, b, err)
		}
	}
}

// fail 调用应失败,返回错误码(Data.code)。
func (d *device) fail(t *testing.T, method string, params any) (code, message string) {
	t.Helper()
	_, err := invoke(d.svc, method, params)
	var re *rpc.Error
	if !errors.As(err, &re) {
		t.Fatalf("%s 应返回 rpc.Error,实际 %v", method, err)
	}
	data, _ := re.Data.(map[string]string)
	return data["code"], re.Message
}

func (d *device) status(t *testing.T) Status {
	t.Helper()
	var st Status
	d.call(t, "sync.status", nil, &st)
	return st
}

func (d *device) path(rel string) string { return filepath.Join(d.root, filepath.FromSlash(rel)) }

func (d *device) write(t *testing.T, rel, text string, mtime time.Time) {
	t.Helper()
	p := d.path(rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
	// 同长度内容在 mtime 精度内会被当作没变(协议 §7.2),测试里显式拉开修改时间
	if err := os.Chtimes(p, mtime, mtime); err != nil {
		t.Fatal(err)
	}
}

func (d *device) read(t *testing.T, rel string) string {
	t.Helper()
	b, err := os.ReadFile(d.path(rel))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("等待超时:%s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

const password = "correct horse battery"

func TestTwoDevicesThroughRPC(t *testing.T) {
	url := newServer(t)
	a, b := newDevice(t, "设备A"), newDevice(t, "设备B")
	base := time.Now().Add(-time.Hour)

	// 注册:返回恢复码,推送完整的会话密钥给外壳写钥匙串
	var reg struct {
		RecoveryCode string
		Status       Status
	}
	a.call(t, "sync.register", map[string]string{"server": url + "/", "email": " A@Example.com", "password": password}, &reg)
	if reg.RecoveryCode == "" || !reg.Status.SignedIn || reg.Status.Email != "a@example.com" || reg.Status.Server != url {
		t.Fatalf("注册结果不对: %+v", reg)
	}
	sec, ok := a.host.lastSecrets()
	if !ok || sec == nil || len(sec.AccountKey) != 32 || sec.RefreshToken == "" || sec.UserID == "" || sec.DeviceID == "" {
		t.Fatalf("注册后应推送会话密钥: %+v", sec)
	}

	// A 关联文件夹(新建云端库)并上传
	a.write(t, "笔记.md", "第一版\n", base)
	var st Status
	a.call(t, "sync.linkVault", map[string]string{"root": a.root, "name": "我的笔记"}, &st)
	if len(st.Vaults) != 1 || !st.Vaults[0].Active || st.Vaults[0].Name != "我的笔记" || st.Vaults[0].Root != a.root {
		t.Fatalf("关联后状态不对: %+v", st)
	}
	vaultID := st.Vaults[0].ID
	a.call(t, "sync.now", map[string]string{}, nil)

	// 同一文件夹的子目录不能再关联
	if err := os.Mkdir(a.path("sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if code, _ := a.fail(t, "sync.linkVault", map[string]string{"root": a.path("sub")}); code != "overlap" {
		t.Fatalf("重叠文件夹应报 overlap,实际 %s", code)
	}

	// B 登录,看到云端库并关联到自己的文件夹,收到内容
	b.call(t, "sync.login", map[string]string{"server": url, "email": "a@example.com", "password": password}, &st)
	if !st.SignedIn || len(st.Vaults) != 0 {
		t.Fatalf("B 登录后状态不对: %+v", st)
	}
	var remote []RemoteVault
	b.call(t, "sync.remoteVaults", nil, &remote)
	if len(remote) != 1 || remote[0].ID != vaultID || remote[0].Name != "我的笔记" || remote[0].Root != "" {
		t.Fatalf("B 看到的云端库不对: %+v", remote)
	}
	b.call(t, "sync.linkVault", map[string]string{"root": b.root, "vaultId": vaultID}, nil)
	b.call(t, "sync.now", map[string]string{"vaultId": vaultID}, nil)
	if got := b.read(t, "笔记.md"); got != "第一版\n" {
		t.Fatalf("B 收到的内容不对: %q", got)
	}

	// A 修改 → B 收到;B 能看到两个历史版本并预览旧版
	a.write(t, "笔记.md", "第二版\n", base.Add(time.Minute))
	a.call(t, "sync.now", nil, nil)
	b.call(t, "sync.now", nil, nil)
	if got := b.read(t, "笔记.md"); got != "第二版\n" {
		t.Fatalf("B 应收到修改: %q", got)
	}
	var vers struct {
		Tracked  bool
		VaultID  string
		Versions []Version
	}
	b.call(t, "sync.versions", map[string]string{"path": b.path("笔记.md")}, &vers)
	if !vers.Tracked || vers.VaultID != vaultID || len(vers.Versions) != 2 || vers.Versions[0].Version != 2 || vers.Versions[0].ThisDevice {
		t.Fatalf("历史版本不对: %+v", vers)
	}
	var text struct{ Text string }
	b.call(t, "sync.readVersion", map[string]any{"path": b.path("笔记.md"), "version": 1}, &text)
	if text.Text != "第一版\n" {
		t.Fatalf("预览版本 1 不对: %q", text.Text)
	}
	b.call(t, "sync.versions", map[string]string{"path": "/不在同步文件夹里.md"}, &vers)
	if vers.Tracked {
		t.Fatal("不在同步文件夹里的文件应返回 tracked=false")
	}

	// A 删除 → B 调外壳把文件移进废纸篓;A 从云端回收站恢复
	if err := os.Remove(a.path("笔记.md")); err != nil {
		t.Fatal(err)
	}
	a.call(t, "sync.now", nil, nil)
	b.call(t, "sync.now", nil, nil)
	if _, err := os.Stat(b.path("笔记.md")); !os.IsNotExist(err) {
		t.Fatalf("B 的文件应被移走: %v", err)
	}
	if got := b.host.trashedPaths(); len(got) != 1 || got[0] != b.path("笔记.md") {
		t.Fatalf("B 应经外壳移进废纸篓: %v", got)
	}
	var trash []TrashItem
	a.call(t, "sync.trash", map[string]string{"vaultId": vaultID}, &trash)
	if len(trash) != 1 || trash[0].Path != "笔记.md" {
		t.Fatalf("回收站不对: %+v", trash)
	}
	a.call(t, "sync.restoreTrash", map[string]string{"vaultId": vaultID, "fileId": trash[0].FileID}, nil)
	if got := a.read(t, "笔记.md"); got != "第二版\n" {
		t.Fatalf("从回收站恢复后内容不对: %q", got)
	}

	// 设备列表:两台,A 是 current;不能移除本机
	var devs []struct {
		ID      string
		Name    string
		Current bool
	}
	a.call(t, "sync.devices", nil, &devs)
	if len(devs) != 2 {
		t.Fatalf("应有两台设备: %+v", devs)
	}
	for _, d := range devs {
		if d.Current != (d.Name == "设备A") {
			t.Fatalf("current 标记不对: %+v", devs)
		}
		if d.Current {
			if code, _ := a.fail(t, "sync.revokeDevice", map[string]string{"id": d.ID}); code != "self_device" {
				t.Fatalf("移除本机应报 self_device,实际 %s", code)
			}
		}
	}

	// B 重启:外壳从钥匙串交回密钥,不联网恢复会话并接着同步原来的文件夹
	bSecrets, _ := b.host.lastSecrets()
	b.svc.Close()
	b.open(t, "设备B")
	if st := b.status(t); st.SignedIn || st.Email != "a@example.com" || len(st.Vaults) != 1 || st.Vaults[0].Active {
		t.Fatalf("重启后、恢复会话前的状态不对: %+v", st)
	}
	b.call(t, "session.resume", map[string]any{"secrets": bSecrets}, &st)
	if !st.SignedIn || len(st.Vaults) != 1 || !st.Vaults[0].Active {
		t.Fatalf("恢复会话后状态不对: %+v", st)
	}
	a.write(t, "新文件.md", "来自 A\n", base.Add(2*time.Minute))
	a.call(t, "sync.now", nil, nil)
	b.call(t, "sync.now", nil, nil)
	if got := b.read(t, "新文件.md"); got != "来自 A\n" {
		t.Fatalf("恢复会话后应继续同步: %q", got)
	}

	// B 退出:通知外壳删除钥匙串条目;配置保留(邮箱、关联),引擎停止
	b.call(t, "sync.logout", nil, &st)
	if sec, ok := b.host.lastSecrets(); !ok || sec != nil {
		t.Fatalf("退出后应推送空密钥: %+v", sec)
	}
	if st.SignedIn || st.Email != "a@example.com" || len(st.Vaults) != 1 || st.Vaults[0].Active {
		t.Fatalf("退出后状态不对: %+v", st)
	}
	if code, _ := b.fail(t, "sync.now", nil); code != "signed_out" {
		t.Fatalf("退出后同步应报 signed_out,实际 %s", code)
	}

	// 解除关联:状态目录删掉、本机文件保留
	a.call(t, "sync.unlinkVault", map[string]string{"vaultId": vaultID}, &st)
	if len(st.Vaults) != 0 {
		t.Fatalf("解除关联后不应还有库: %+v", st)
	}
	if _, err := os.Stat(filepath.Join(a.dataDir, "vaults", vaultID)); !os.IsNotExist(err) {
		t.Fatalf("状态目录应被删除: %v", err)
	}
	if got := a.read(t, "笔记.md"); got != "第二版\n" {
		t.Fatal("解除关联不应动本机文件")
	}
	if a.host.count(NotifyEvent) == 0 || a.host.count(NotifyStatus) == 0 {
		t.Fatal("同步过程中应推送事件与状态")
	}
}

func TestLoginErrorsAndSessionLoss(t *testing.T) {
	url := newServer(t)
	a, b := newDevice(t, "设备A"), newDevice(t, "设备B")

	if code, _ := a.fail(t, "sync.register", map[string]string{"server": url, "email": "x@example.com", "password": "short"}); code != "weak_password" {
		t.Fatalf("短密码应报 weak_password,实际 %s", code)
	}
	if code, _ := a.fail(t, "sync.register", map[string]string{"server": "", "email": "x@example.com", "password": password}); code != "invalid_server" {
		t.Fatalf("空服务器地址应报 invalid_server,实际 %s", code)
	}
	a.call(t, "sync.register", map[string]string{"server": url, "email": "x@example.com", "password": password}, nil)
	if code, _ := a.fail(t, "sync.login", map[string]string{"server": url, "email": "x@example.com", "password": password}); code != "signed_in" {
		t.Fatalf("已登录时再登录应报 signed_in,实际 %s", code)
	}
	if code, msg := b.fail(t, "sync.login", map[string]string{"server": url, "email": "x@example.com", "password": "wrong password"}); code != "unauthorized" || msg != "邮箱或主密码错误" {
		t.Fatalf("错误密码的提示不对: %s %s", code, msg)
	}
	if code, _ := b.fail(t, "sync.register", map[string]string{"server": url, "email": "X@example.com", "password": password}); code != "email_taken" {
		t.Fatalf("重复注册应报 email_taken,实际 %s", code)
	}
	b.call(t, "sync.login", map[string]string{"server": url, "email": "x@example.com", "password": password}, nil)

	// A 移除 B:B 的下一个请求发现登录失效 → 结束会话、通知外壳清钥匙串、状态带原因
	var devs []struct {
		ID      string
		Current bool
	}
	a.call(t, "sync.devices", nil, &devs)
	for _, d := range devs {
		if !d.Current {
			a.call(t, "sync.revokeDevice", map[string]string{"id": d.ID}, nil)
		}
	}
	if code, _ := b.fail(t, "sync.account", nil); code != "session_lost" {
		t.Fatalf("被移除的设备请求应报 session_lost,实际 %s", code)
	}
	waitFor(t, "B 的会话被结束", func() bool {
		st := b.status(t)
		return !st.SignedIn && st.AuthError != ""
	})
	if sec, ok := b.host.lastSecrets(); !ok || sec != nil {
		t.Fatalf("登录失效后应推送空密钥: %+v", sec)
	}

	// 恢复码重置主密码:新密码可登录
	var reg struct{ RecoveryCode string }
	c := newDevice(t, "设备C")
	c.call(t, "sync.register", map[string]string{"server": url, "email": "y@example.com", "password": password}, &reg)
	c.call(t, "sync.logout", nil, nil)
	c.call(t, "sync.recover", map[string]string{"server": url, "email": "y@example.com", "recoveryCode": reg.RecoveryCode, "newPassword": "a brand new password"}, nil)
	c.call(t, "sync.logout", nil, nil)
	c.call(t, "sync.login", map[string]string{"server": url, "email": "y@example.com", "password": "a brand new password"}, nil)
	if code, _ := c.fail(t, "sync.changePassword", map[string]string{"oldPassword": "not it", "newPassword": "another long password"}); code != "unauthorized" {
		t.Fatalf("旧密码错误应报 unauthorized,实际 %s", code)
	}
	if !c.status(t).SignedIn {
		t.Fatal("改密时旧密码输错不应结束会话")
	}
}

func TestNormalizeServerAndOverlaps(t *testing.T) {
	for in, want := range map[string]string{
		"sync.example.com":            "https://sync.example.com",
		" https://sync.example.com/ ": "https://sync.example.com",
		"https://x.com/v1":            "https://x.com",
		"http://127.0.0.1:8080/v1/":   "http://127.0.0.1:8080",
		"https://x.com/typoza/":       "https://x.com/typoza",
	} {
		if got, err := normalizeServer(in); err != nil || got != want {
			t.Errorf("normalizeServer(%q) = %q, %v;应为 %q", in, got, err, want)
		}
	}
	if _, err := normalizeServer("  "); err == nil {
		t.Error("空地址应报错")
	}
	cases := []struct {
		a, b string
		want bool
	}{
		{"/a/b", "/a/b", true},
		{"/a/b", "/a/b/c", true},
		{"/a/b/c", "/a/b", true},
		{"/a/b", "/a/bc", false},
		{"/a/b", "/a/c", false},
	}
	for _, c := range cases {
		if got := overlaps(c.a, c.b); got != c.want {
			t.Errorf("overlaps(%q, %q) = %v", c.a, c.b, got)
		}
	}
	if rel, ok := relIn("/a/b", "/a/b/c/d.md"); !ok || rel != "c/d.md" {
		t.Errorf("relIn 不对: %q %v", rel, ok)
	}
	if _, ok := relIn("/a/b", "/a/bc/d.md"); ok {
		t.Error("/a/bc 不在 /a/b 下")
	}
}
