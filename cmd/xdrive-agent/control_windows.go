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
	mux.HandleFunc("/register", handler.register)
	mux.HandleFunc("/mount", handler.mount)
	mux.HandleFunc("/pause", handler.pause)
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
		Paused: s.Paused, LastError: s.LastError, Version: s.Version,
		Message: r.URL.Query().Get("message"),
	}
	if err := controlPage.Execute(w, data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
	http.Redirect(w, r, "/?token="+url.QueryEscape(h.token)+"&message="+url.QueryEscape(message), http.StatusSeeOther)
}

func (h *controlHandler) login(w http.ResponseWriter, r *http.Request) {
	if !h.parse(w, r) {
		return
	}
	if err := h.ctrl.Authenticate(false, r.FormValue("server"), r.FormValue("username"), r.FormValue("password"), r.FormValue("mount")); err != nil {
		h.redirect(w, r, "登录失败："+err.Error())
		return
	}
	h.redirect(w, r, "登录成功，xDrive 正在启动同步。")
}

func (h *controlHandler) register(w http.ResponseWriter, r *http.Request) {
	if !h.parse(w, r) {
		return
	}
	if err := h.ctrl.Authenticate(true, r.FormValue("server"), r.FormValue("username"), r.FormValue("password"), r.FormValue("mount")); err != nil {
		h.redirect(w, r, "注册失败："+err.Error())
		return
	}
	h.redirect(w, r, "注册并登录成功，xDrive 正在启动同步。")
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

type controlPageData struct {
	Token      string
	Configured bool
	Username   string
	Server     string
	MountPath  string
	AuthStatus string
	SyncStatus string
	Paused     bool
	LastError  string
	Version    string
	Message    string
}

var controlPage = template.Must(template.New("control").Parse(controlHTML))

const controlHTML = "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>xDrive</title>\n<style>\n:root{font-family:\"Segoe UI\",system-ui,sans-serif;color:#172033;background:#f5f7fb}\nbody{margin:0;padding:32px}.wrap{max-width:720px;margin:auto}.card{background:#fff;border:1px solid #e4e8f0;border-radius:14px;padding:22px;margin:14px 0;box-shadow:0 4px 18px rgba(20,35,60,.06)}\nh1{margin:0 0 4px;font-size:28px}h2{font-size:18px;margin:0 0 16px}.muted{color:#667085}.grid{display:grid;grid-template-columns:130px 1fr;gap:8px 14px}.error{color:#b42318;white-space:pre-wrap}.msg{background:#eef4ff;border-radius:9px;padding:10px 12px;margin:12px 0}\nlabel{display:block;font-size:13px;color:#475467;margin-top:12px}input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cfd6e4;border-radius:8px;font-size:14px}\n.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}button{border:0;border-radius:8px;padding:9px 14px;cursor:pointer;background:#2563eb;color:white;font-weight:600}button.secondary{background:#eef2f8;color:#26334d}button.danger{background:#b42318}\nform.inline{display:inline}.footer{font-size:12px;color:#98a2b3;margin-top:18px}\n</style>\n</head>\n<body><div class=\"wrap\">\n<h1>xDrive</h1><div class=\"muted\">Windows 客户端控制中心 · {{.Version}}</div>\n{{if .Message}}<div class=\"msg\">{{.Message}}</div>{{end}}\n<div class=\"card\"><h2>状态</h2>\n<div class=\"grid\"><div>登录状态</div><div>{{.AuthStatus}}{{if .Username}} · {{.Username}}{{end}}</div>\n<div>同步状态</div><div>{{.SyncStatus}}</div>\n{{if .Server}}<div>服务器</div><div>{{.Server}}</div>{{end}}\n{{if .MountPath}}<div>xDrive 目录</div><div>{{.MountPath}}</div>{{end}}</div>\n{{if .LastError}}<p class=\"error\">{{.LastError}}</p>{{end}}\n{{if .Configured}}<div class=\"actions\">\n<form class=\"inline\" method=\"post\" action=\"/open?token={{.Token}}\"><button type=\"submit\">打开 xDrive</button></form>\n<form class=\"inline\" method=\"post\" action=\"/pause?token={{.Token}}\"><button class=\"secondary\" type=\"submit\">{{if .Paused}}恢复同步{{else}}暂停同步{{end}}</button></form>\n<form class=\"inline\" method=\"post\" action=\"/logout?token={{.Token}}\"><button class=\"danger\" type=\"submit\">注销</button></form>\n</div>{{end}}\n</div>\n\n<div class=\"card\"><h2>{{if .Configured}}账户 / 重新登录{{else}}登录 / 注册{{end}}</h2>\n<form method=\"post\" action=\"/login?token={{.Token}}\">\n<label>服务器地址</label><input name=\"server\" required placeholder=\"https://drive.example.com\" value=\"{{.Server}}\">\n<label>用户名</label><input name=\"username\" required autocomplete=\"username\" value=\"{{.Username}}\">\n<label>密码</label><input name=\"password\" required type=\"password\" autocomplete=\"current-password\">\n<label>xDrive 目录（可选）</label><input name=\"mount\" placeholder=\"C:\\Users\\你\\xDrive\" value=\"{{.MountPath}}\">\n<div class=\"actions\"><button type=\"submit\">登录</button>\n<button class=\"secondary\" type=\"submit\" formaction=\"/register?token={{.Token}}\">注册新账号</button></div>\n</form></div>\n\n{{if .Configured}}<div class=\"card\"><h2>同步目录</h2>\n<form method=\"post\" action=\"/mount?token={{.Token}}\">\n<label>本地路径</label><input name=\"mount\" required value=\"{{.MountPath}}\">\n<div class=\"actions\"><button type=\"submit\">保存并重新挂载</button></div>\n</form></div>{{end}}\n<div class=\"footer\">此页面仅监听 127.0.0.1，并使用当前 agent 会话随机令牌保护。密码不会保存到本地配置。</div>\n</div></body></html>"
