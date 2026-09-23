//go:build windows

package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"html/template"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"time"
)

type localControl struct {
	url string
}

func (c *localControl) Open() error {
	return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", c.url).Start()
}

func (c *localControl) OpenConflicts() error {
	return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", c.url+"#conflicts").Start()
}

func startControlUI(ctx context.Context, ctrl *agentController) (controlUI, error) {
	var tokenBytes [24]byte
	if _, err := rand.Read(tokenBytes[:]); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(tokenBytes[:])
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	baseURL := "http://" + listener.Addr().String()
	control := &localControl{url: baseURL + "/?token=" + url.QueryEscape(token)}

	mux := http.NewServeMux()
	handler := &controlHandler{ctrl: ctrl, token: token}
	mux.HandleFunc("/", handler.index)
	mux.HandleFunc("/login", handler.login)
	mux.HandleFunc("/password", handler.password)
	mux.HandleFunc("/mount", handler.mount)
	mux.HandleFunc("/pause", handler.pause)
	mux.HandleFunc("/sync", handler.sync)
	mux.HandleFunc("/file", handler.fileAction)
	mux.HandleFunc("/conflict/open", handler.conflictOpen)
	mux.HandleFunc("/conflict/resolve", handler.conflictResolve)
	mux.HandleFunc("/logout", handler.logout)
	mux.HandleFunc("/open", handler.open)

	server := &http.Server{Handler: securityHeaders(mux), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	go func() { _ = server.Serve(listener) }()
	return control, nil
}

type controlHandler struct {
	ctrl  *agentController
	token string
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
			http.Error(w, "loopback only", http.StatusForbidden)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'")
		next.ServeHTTP(w, r)
	})
}

func (h *controlHandler) authorized(r *http.Request) bool {
	return r.URL.Query().Get("token") == h.token
}

func (h *controlHandler) index(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet || !h.authorized(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	s := h.ctrl.Snapshot()
	data := controlPageData{
		Token: h.token, Configured: s.Configured, Username: s.Username, Server: s.Server,
		MountPath: s.MountPath, AuthStatus: s.AuthStatus, SyncStatus: s.SyncStatus,
		Paused: s.Paused, MustChangePassword: s.MustChangePassword,
		LastError: s.LastError, Version: s.Version, Message: r.URL.Query().Get("message"),
		ConflictCount: s.ConflictCount,
	}
	if s.Configured {
		path := r.URL.Query().Get("file")
		if path == "" {
			path = s.MountPath
		}
		data.FilePath = path
		if state, err := h.ctrl.FileAvailability(path); err == nil {
			data.FileState = availabilityLabel(state.Mode)
		} else if path != "" {
			data.FileState = "无法读取：" + err.Error()
		}
		for _, item := range h.ctrl.Conflicts() {
			data.Conflicts = append(data.Conflicts, conflictPageItem{
				ID: item.ID, OriginalPath: item.OriginalPath, ConflictPath: item.ConflictPath,
				Created: item.CreatedAt.Local().Format("2006-01-02 15:04:05"),
			})
		}
	}
	if err := controlPage.Execute(w, data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func availabilityLabel(mode string) string {
	switch mode {
	case "syncing":
		return "同步中"
	case "always-local":
		return "始终保留在此设备"
	case "online-only":
		return "仅在线"
	case "cloud":
		return "云端文件（使用时下载）"
	case "local":
		return "本地可用"
	default:
		return "未知"
	}
}

func (h *controlHandler) parse(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost || !h.authorized(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid form", http.StatusBadRequest)
		return false
	}
	return true
}

func (h *controlHandler) redirect(w http.ResponseWriter, r *http.Request, message string) {
	target := "/?token=" + url.QueryEscape(h.token) + "&message=" + url.QueryEscape(message)
	if file := r.FormValue("path"); file != "" {
		target += "&file=" + url.QueryEscape(file)
	}
	http.Redirect(w, r, target, http.StatusSeeOther)
}

func (h *controlHandler) login(w http.ResponseWriter, r *http.Request) {
	if !h.parse(w, r) {
		return
	}
	if err := h.ctrl.Authenticate(r.FormValue("server"), r.FormValue("username"), r.FormValue("password"), r.FormValue("mount")); err != nil {
		h.redirect(w, r, "登录失败："+err.Error())
		return
	}
	h.redirect(w, r, "登录成功。")
}

func (h *controlHandler) password(w http.ResponseWriter, r *http.Request) {
	if !h.parse(w, r) {
		return
	}
	if err := h.ctrl.ChangePassword(r.FormValue("current_password"), r.FormValue("new_password")); err != nil {
		h.redirect(w, r, "修改密码失败："+err.Error())
		return
	}
	h.redirect(w, r, "密码已修改，xDrive 正在恢复同步。")
}

func (h *controlHandler) mount(w http.ResponseWriter, r *http.Request) {
	if !h.parse(w, r) {
		return
	}
	if err := h.ctrl.SaveMountPath(r.FormValue("mount")); err != nil {
		h.redirect(w, r, "修改同步目录失败："+err.Error())
		return
	}
	h.redirect(w, r, "同步目录已更新。")
}

func (h *controlHandler) pause(w http.ResponseWriter, r *http.Request) {
	if !h.parse(w, r) {
		return
	}
	if err := h.ctrl.TogglePause(); err != nil {
		h.redirect(w, r, "操作失败："+err.Error())
		return
	}
	h.redirect(w, r, "同步状态已更新。")
}

func (h *controlHandler) sync(w http.ResponseWriter, r *http.Request) {
	if !h.parse(w, r) {
		return
	}
	if err := h.ctrl.SyncNow(); err != nil {
		h.redirect(w, r, "立即同步失败："+err.Error())
		return
	}
	h.redirect(w, r, "已开始立即同步。")
}

func (h *controlHandler) fileAction(w http.ResponseWriter, r *http.Request) {
	if !h.parse(w, r) {
		return
	}
	action := r.FormValue("action")
	if err := h.ctrl.SetFileAvailability(r.FormValue("path"), action); err != nil {
		h.redirect(w, r, "文件状态操作失败："+err.Error())
		return
	}
	message := map[string]string{
		"keep":    "已设为始终保留在此设备。",
		"release": "已释放本地空间，文件保留在云端。",
		"online":  "已设为仅在线。",
		"sync":    "已开始立即同步。",
	}[action]
	if message == "" {
		message = "文件状态已更新。"
	}
	h.redirect(w, r, message)
}

func (h *controlHandler) conflictOpen(w http.ResponseWriter, r *http.Request) {
	if !h.parse(w, r) {
		return
	}
	if err := h.ctrl.OpenConflict(r.FormValue("id"), r.FormValue("mode") == "both"); err != nil {
		h.redirect(w, r, "打开冲突失败："+err.Error())
		return
	}
	h.redirect(w, r, "已打开冲突文件。")
}

func (h *controlHandler) conflictResolve(w http.ResponseWriter, r *http.Request) {
	if !h.parse(w, r) {
		return
	}
	choice := r.FormValue("choice")
	if err := h.ctrl.ResolveConflict(r.FormValue("id"), choice); err != nil {
		h.redirect(w, r, "解决冲突失败："+err.Error())
		return
	}
	if choice == "local" {
		h.redirect(w, r, "已保留本地版本并覆盖服务器原文件。")
		return
	}
	h.redirect(w, r, "已保留服务器版本并删除冲突副本。")
}

func (h *controlHandler) logout(w http.ResponseWriter, r *http.Request) {
	if !h.parse(w, r) {
		return
	}
	if err := h.ctrl.Logout(); err != nil {
		h.redirect(w, r, "注销失败："+err.Error())
		return
	}
	h.redirect(w, r, "已注销。")
}

func (h *controlHandler) open(w http.ResponseWriter, r *http.Request) {
	if !h.parse(w, r) {
		return
	}
	if err := h.ctrl.OpenFolder(); err != nil {
		h.redirect(w, r, "打开 xDrive 失败："+err.Error())
		return
	}
	h.redirect(w, r, "已打开 xDrive。")
}

type conflictPageItem struct {
	ID           string
	OriginalPath string
	ConflictPath string
	Created      string
}

type controlPageData struct {
	Token              string
	Configured         bool
	Username           string
	Server             string
	MountPath          string
	AuthStatus         string
	SyncStatus         string
	Paused             bool
	MustChangePassword bool
	LastError          string
	Version            string
	Message            string
	ConflictCount      int
	FilePath           string
	FileState          string
	Conflicts          []conflictPageItem
}

var controlPage = template.Must(template.New("control").Parse(controlHTML))

const controlHTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>xDrive</title>
<style>
:root{font-family:"Segoe UI",system-ui,sans-serif;color:#172033;background:#f5f7fb}
body{margin:0;padding:32px}.wrap{max-width:820px;margin:auto}.card{background:#fff;border:1px solid #e4e8f0;border-radius:14px;padding:22px;margin:14px 0;box-shadow:0 4px 18px rgba(20,35,60,.06)}
h1{margin:0 0 4px;font-size:28px}h2{font-size:18px;margin:0 0 16px}.muted{color:#667085}.grid{display:grid;grid-template-columns:140px 1fr;gap:8px 14px}.error{color:#b42318;white-space:pre-wrap}.msg{background:#eef4ff;border-radius:9px;padding:10px 12px;margin:12px 0}.warning{background:#fff5e8;color:#8a4b00;border-radius:9px;padding:10px 12px;margin:12px 0}
label{display:block;font-size:13px;color:#475467;margin-top:12px}input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cfd6e4;border-radius:8px;font-size:14px}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}button{border:0;border-radius:8px;padding:9px 14px;cursor:pointer;background:#2563eb;color:white;font-weight:600}button.secondary{background:#eef2f8;color:#26334d}button.danger{background:#b42318}button.warn{background:#b54708}
form.inline{display:inline}.footer{font-size:12px;color:#98a2b3;margin-top:18px}.conflict{padding:14px 0;border-top:1px solid #edf0f5}.conflict:first-child{border-top:0}.path{font-family:Consolas,monospace;font-size:12px;word-break:break-all}.badge{display:inline-block;background:#eef4ff;color:#175cd3;padding:3px 8px;border-radius:999px;font-size:12px}
</style>
</head>
<body><div class="wrap">
<h1>xDrive</h1><div class="muted">Windows 客户端控制中心 · {{.Version}}</div>
{{if .Message}}<div class="msg">{{.Message}}</div>{{end}}
{{if .MustChangePassword}}<div class="warning">管理员要求你修改初始密码。完成修改前，xDrive 不会启动同步。</div>{{end}}

<div class="card"><h2>状态</h2>
<div class="grid"><div>登录状态</div><div>{{.AuthStatus}}{{if .Username}} · {{.Username}}{{end}}</div>
<div>同步状态</div><div>{{.SyncStatus}}</div>
<div>待处理冲突</div><div>{{.ConflictCount}}</div>
{{if .Server}}<div>服务器</div><div>{{.Server}}</div>{{end}}
{{if .MountPath}}<div>xDrive 目录</div><div>{{.MountPath}}</div>{{end}}</div>
{{if .LastError}}<p class="error">{{.LastError}}</p>{{end}}
{{if .Configured}}<div class="actions">
<form class="inline" method="post" action="/open?token={{.Token}}"><button type="submit">打开 xDrive</button></form>
<form class="inline" method="post" action="/sync?token={{.Token}}"><button type="submit">立即同步</button></form>
<form class="inline" method="post" action="/pause?token={{.Token}}"><button class="secondary" type="submit">{{if .Paused}}恢复同步{{else}}暂停同步{{end}}</button></form>
<form class="inline" method="post" action="/logout?token={{.Token}}"><button class="danger" type="submit">注销</button></form>
</div>{{end}}</div>

{{if .Configured}}
<div class="card"><h2>文件可用性</h2>
<p class="muted">Explorer 会显示 Windows 原生云文件状态图标。输入 xDrive 内的文件或目录，可主动控制本地保留策略。</p>
<form method="post" action="/file?token={{.Token}}">
<label>文件或目录路径</label><input name="path" required value="{{.FilePath}}">
<div class="grid" style="margin-top:12px"><div>当前状态</div><div><span class="badge">{{.FileState}}</span></div></div>
<div class="actions">
<button name="action" value="keep" type="submit">始终保留在此设备</button>
<button class="secondary" name="action" value="release" type="submit">释放空间</button>
<button class="secondary" name="action" value="online" type="submit">仅在线</button>
<button class="secondary" name="action" value="sync" type="submit">立即同步</button>
</div></form>
</div>

<div class="card" id="conflicts"><h2>冲突处理 {{if .ConflictCount}}（{{.ConflictCount}}）{{end}}</h2>
{{if .Conflicts}}
<p class="muted">服务器版本继续保留在原文件名；本地旧版本保存在冲突副本中。选择最终要保留的版本。</p>
{{range .Conflicts}}<div class="conflict">
<div><strong>{{.OriginalPath}}</strong> <span class="muted">· {{.Created}}</span></div>
<div class="path">冲突副本：{{.ConflictPath}}</div>
<div class="actions">
<form class="inline" method="post" action="/conflict/open?token={{$.Token}}"><input type="hidden" name="id" value="{{.ID}}"><input type="hidden" name="mode" value="reveal"><button class="secondary" type="submit">查看冲突</button></form>
<form class="inline" method="post" action="/conflict/open?token={{$.Token}}"><input type="hidden" name="id" value="{{.ID}}"><input type="hidden" name="mode" value="both"><button class="secondary" type="submit">打开两个版本</button></form>
<form class="inline" method="post" action="/conflict/resolve?token={{$.Token}}"><input type="hidden" name="id" value="{{.ID}}"><input type="hidden" name="choice" value="local"><button class="warn" type="submit">保留本地版本</button></form>
<form class="inline" method="post" action="/conflict/resolve?token={{$.Token}}"><input type="hidden" name="id" value="{{.ID}}"><input type="hidden" name="choice" value="server"><button class="danger" type="submit">保留服务器版本</button></form>
</div></div>{{end}}
{{else}}<p class="muted">当前没有待处理冲突。</p>{{end}}
</div>
{{end}}

<div class="card"><h2>{{if .Configured}}账户 / 重新登录{{else}}登录{{end}}</h2>
<form method="post" action="/login?token={{.Token}}">
<label>服务器地址</label><input name="server" required placeholder="https://drive.example.com" value="{{.Server}}">
<label>用户名</label><input name="username" required autocomplete="username" value="{{.Username}}">
<label>密码</label><input name="password" required type="password" autocomplete="current-password">
<label>xDrive 目录（可选）</label><input name="mount" placeholder="C:\Users\你\xDrive" value="{{.MountPath}}">
<div class="actions"><button type="submit">登录</button></div>
</form><p class="muted">xDrive 不开放自助注册，账号由服务器管理员统一创建。</p></div>

{{if .Configured}}
<div class="card"><h2>修改密码</h2><form method="post" action="/password?token={{.Token}}">
<label>当前密码</label><input name="current_password" required type="password" autocomplete="current-password">
<label>新密码</label><input name="new_password" required minlength="8" type="password" autocomplete="new-password">
<div class="actions"><button type="submit">修改密码</button></div></form></div>

<div class="card"><h2>同步目录</h2><form method="post" action="/mount?token={{.Token}}">
<label>本地路径</label><input name="mount" required value="{{.MountPath}}">
<div class="actions"><button type="submit">保存并重新挂载</button></div></form></div>
{{end}}
<div class="footer">此页面仅监听 127.0.0.1，并使用当前 agent 会话随机令牌保护。密码不会保存到本地配置。</div>
</div></body></html>`

