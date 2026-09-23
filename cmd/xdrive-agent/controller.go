package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/mount"
	xupdate "github.com/lazyxu/xdrive/internal/update"
	"github.com/lazyxu/xdrive/internal/userconfig"
	"github.com/lazyxu/xdrive/internal/version"
)

type agentSnapshot struct {
	Configured         bool
	Username           string
	Server             string
	MountPath          string
	AuthStatus         string
	SyncStatus         string
	Paused             bool
	MustChangePassword bool
	LastError          string
	HasConflict        bool
	Version            string
}

type agentNotification struct {
	Title string
	Body  string
	Kind  string
}

type agentController struct {
	ctx           context.Context
	cancel        context.CancelFunc
	wake          chan struct{}
	notifications chan agentNotification

	mu   sync.RWMutex
	snap agentSnapshot
}

func newAgentController(ctx context.Context, cancel context.CancelFunc) *agentController {
	return &agentController{
		ctx:    ctx,
		cancel: cancel,
		wake:   make(chan struct{}, 1),
		notifications: make(chan agentNotification, 16),
		snap: agentSnapshot{
			AuthStatus: "未登录",
			SyncStatus: "等待登录",
			Version:    version.String(),
		},
	}
}

func (c *agentController) Notifications() <-chan agentNotification { return c.notifications }

func (c *agentController) notify(n agentNotification) {
	select {
	case c.notifications <- n:
	default:
	}
}

func (c *agentController) Snapshot() agentSnapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.snap
}

func (c *agentController) setSnapshot(fn func(*agentSnapshot)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	fn(&c.snap)
}

func (c *agentController) setLastError(msg string) {
	c.setSnapshot(func(s *agentSnapshot) { s.LastError = msg })
}

func (c *agentController) wakeNow() {
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

func (c *agentController) Run() {
	updateReady := startAutoUpdate(c.ctx)
	mount.SetEventSink(func(event mount.Event) {
		if event.Kind == mount.EventConflict {
			c.setSnapshot(func(s *agentSnapshot) { s.HasConflict = true; s.SyncStatus = "存在冲突副本" })
			body := "已保留冲突副本"
			if event.Path != "" {
				body += "：" + event.Path
			}
			c.notify(agentNotification{Title: "xDrive 冲突", Body: body, Kind: "warning"})
		}
	})
	defer mount.SetEventSink(nil)

	var (
		running       bool
		currentKey    string
		mountCancel   context.CancelFunc
		mountDone     chan error
		lastAuthCheck time.Time
	)

	stopMount := func() {
		if mountCancel != nil {
			mountCancel()
		}
	}

	startMount := func(d desiredMount) {
		cli, err := userconfig.NewClient(d.cfg)
		if err != nil {
			c.setSnapshot(func(s *agentSnapshot) {
				s.AuthStatus = "需要重新登录"
				s.SyncStatus = "凭证不可用"
				s.LastError = err.Error()
			})
			return
		}
		mctx, mcancel := context.WithCancel(c.ctx)
		done := make(chan error, 1)
		running = true
		currentKey = d.key
		mountCancel = mcancel
		mountDone = done
		lastAuthCheck = time.Now()
		c.setSnapshot(func(s *agentSnapshot) {
			s.SyncStatus = "同步正常"
			s.LastError = ""
		})
		c.notify(agentNotification{Title: "xDrive", Body: "同步完成", Kind: "info"})
		go func() {
			done <- mount.Run(mctx, cli, d.root)
		}()
	}

	reconcile := func() {
		d, loadErr := loadDesired()
		if loadErr != nil {
			if running {
				stopMount()
			}
			c.setSnapshot(func(s *agentSnapshot) {
				*s = agentSnapshot{
					AuthStatus: "未登录",
					SyncStatus: "等待登录",
					Version:    version.String(),
				}
			})
			return
		}

		c.setSnapshot(func(s *agentSnapshot) {
			s.Configured = true
			s.Username = d.cfg.Username
			s.Server = d.cfg.Server
			s.MountPath = d.root
			s.Paused = d.cfg.Paused
			s.MustChangePassword = d.cfg.MustChangePassword
			if s.AuthStatus == "未登录" {
				s.AuthStatus = "已登录"
			}
		})

		if d.cfg.MustChangePassword {
			if running {
				stopMount()
			}
			c.setSnapshot(func(s *agentSnapshot) {
				s.AuthStatus = "需要修改密码"
				s.SyncStatus = "等待修改密码"
				s.MustChangePassword = true
				s.LastError = ""
			})
			return
		}

		if d.cfg.Paused {
			if running {
				stopMount()
			}
			c.setSnapshot(func(s *agentSnapshot) {
				s.AuthStatus = "已登录"
				s.SyncStatus = "已暂停"
				s.LastError = ""
			})
			return
		}

		if running && d.key != currentKey {
			stopMount()
			return
		}

		if running {
			if time.Since(lastAuthCheck) < time.Minute {
				return
			}
			lastAuthCheck = time.Now()
			checkCtx, cancel := context.WithTimeout(c.ctx, 8*time.Second)
			cli, clientErr := userconfig.NewClient(d.cfg)
			if clientErr != nil {
				cancel()
				stopMount()
				c.setSnapshot(func(s *agentSnapshot) {
					s.AuthStatus = "需要重新登录"
					s.SyncStatus = "凭证不可用"
					s.LastError = clientErr.Error()
				})
				return
			}
			_, err := cli.Root(checkCtx)
			cancel()
			if err == nil {
				c.setSnapshot(func(s *agentSnapshot) {
					s.AuthStatus = "已登录"
					s.SyncStatus = "同步正常"
					s.LastError = ""
				})
				return
			}
			var apiErr *client.APIError
			if errors.As(err, &apiErr) {
				switch apiErr.Msg {
				case "password_change_required":
					stopMount()
					c.setSnapshot(func(s *agentSnapshot) {
						s.AuthStatus = "需要修改密码"
						s.SyncStatus = "等待修改密码"
						s.MustChangePassword = true
						s.LastError = ""
					})
					return
				case "account_disabled":
					stopMount()
					c.setSnapshot(func(s *agentSnapshot) {
						s.AuthStatus = "账户已禁用"
						s.SyncStatus = "同步已停止"
						s.LastError = ""
					})
					c.notify(agentNotification{Title: "xDrive", Body: "登录已失效，请重新登录。", Kind: "warning"})
					return
				}
				if apiErr.Status == 401 || apiErr.Status == 403 {
					stopMount()
					c.setSnapshot(func(s *agentSnapshot) {
						s.AuthStatus = "登录已过期"
						s.SyncStatus = "需要重新登录"
						s.LastError = err.Error()
					})
					c.notify(agentNotification{Title: "xDrive", Body: "登录已失效，请重新登录。", Kind: "warning"})
					return
				}
			}
			c.setSnapshot(func(s *agentSnapshot) {
				s.SyncStatus = "网络暂不可用"
				s.LastError = err.Error()
			})
			return
		}

		checkCtx, cancel := context.WithTimeout(c.ctx, 10*time.Second)
		cli, clientErr := userconfig.NewClient(d.cfg)
		if clientErr != nil {
			cancel()
			c.setSnapshot(func(s *agentSnapshot) {
				s.AuthStatus = "需要重新登录"
				s.SyncStatus = "凭证不可用"
				s.LastError = clientErr.Error()
			})
			return
		}
		_, err := cli.Root(checkCtx)
		cancel()
		if err != nil {
			var apiErr *client.APIError
			if errors.As(err, &apiErr) && (apiErr.Status == 401 || apiErr.Status == 403) {
				c.setSnapshot(func(s *agentSnapshot) {
					s.AuthStatus = "登录已过期"
					s.SyncStatus = "需要重新登录"
					s.LastError = err.Error()
				})
				c.notify(agentNotification{Title: "xDrive", Body: "登录已失效，请重新登录。", Kind: "warning"})
				return
			}
			c.setSnapshot(func(s *agentSnapshot) {
				s.AuthStatus = "已登录"
				s.SyncStatus = "连接失败"
				s.LastError = err.Error()
			})
			return
		}

		c.setSnapshot(func(s *agentSnapshot) {
			s.AuthStatus = "已登录"
			s.SyncStatus = "正在启动同步"
			s.LastError = ""
		})
		startMount(d)
	}

	reconcile()
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-c.ctx.Done():
			stopMount()
			waitMountDone(mountDone)
			return
		case <-updateReady:
			stopMount()
			waitMountDone(mountDone)
			c.cancel()
			return
		case err := <-mountDone:
			running = false
			currentKey = ""
			mountCancel = nil
			mountDone = nil
			if err != nil && !errors.Is(err, context.Canceled) {
				c.setSnapshot(func(s *agentSnapshot) {
					s.SyncStatus = "同步错误"
					s.LastError = err.Error()
				})
			}
		case <-c.wake:
			reconcile()
		case <-ticker.C:
			reconcile()
		}
	}
}

func waitMountDone(ch <-chan error) {
	if ch == nil {
		return
	}
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
	}
}

func (c *agentController) Authenticate(server, username, password, mountPath string) error {
	server = strings.TrimRight(strings.TrimSpace(server), "/")
	username = strings.TrimSpace(username)
	mountPath = strings.TrimSpace(mountPath)
	if server == "" || username == "" || password == "" {
		return fmt.Errorf("服务器、用户名和密码不能为空")
	}

	ctx, cancel := context.WithTimeout(c.ctx, 30*time.Second)
	defer cancel()
	resp, err := client.New(server, "").Login(ctx, username, password)
	if err != nil {
		return err
	}

	sessionID := ""
	if old, loadErr := userconfig.Load(); loadErr == nil {
		if mountPath == "" {
			mountPath = old.MountPath
		}
		sessionID = old.SessionID
	}
	cfg := userconfig.Config{
		Server:    server,
		MountPath: mountPath,
		SessionID: sessionID,
		Paused:    false,
	}
	if err := cfg.ApplyAuth(resp, true); err != nil {
		return err
	}
	if err := userconfig.Save(cfg); err != nil {
		return err
	}
	c.setSnapshot(func(s *agentSnapshot) {
		s.Configured = true
		s.Username = resp.Username
		s.Server = server
		s.MustChangePassword = resp.MustChangePassword
		if resp.MustChangePassword {
			s.AuthStatus = "需要修改密码"
			s.SyncStatus = "等待修改密码"
		} else {
			s.AuthStatus = "已登录"
			s.SyncStatus = "正在启动同步"
		}
		s.Paused = false
		s.LastError = ""
	})
	c.wakeNow()
	return nil
}

func (c *agentController) ChangePassword(currentPassword, newPassword string) error {
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(c.ctx, 30*time.Second)
	defer cancel()
	cli, err := userconfig.NewClient(cfg)
	if err != nil {
		return err
	}
	resp, err := cli.ChangePassword(ctx, currentPassword, newPassword)
	if err != nil {
		return err
	}
	latest, err := userconfig.Load()
	if err != nil {
		latest = cfg
	}
	if err := latest.ApplyAuth(resp, false); err != nil {
		return err
	}
	if err := userconfig.Save(latest); err != nil {
		return err
	}
	c.setSnapshot(func(s *agentSnapshot) {
		s.MustChangePassword = false
		s.AuthStatus = "已登录"
		s.SyncStatus = "正在启动同步"
		s.LastError = ""
	})
	c.wakeNow()
	return nil
}

func (c *agentController) SaveMountPath(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("同步目录不能为空")
	}
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	cfg.MountPath = filepath.Clean(abs)
	if err := userconfig.Save(cfg); err != nil {
		return err
	}
	c.wakeNow()
	return nil
}

func (c *agentController) TogglePause() error {
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	cfg.Paused = !cfg.Paused
	if err := userconfig.Save(cfg); err != nil {
		return err
	}
	c.setSnapshot(func(s *agentSnapshot) {
		s.Paused = cfg.Paused
		if cfg.Paused {
			s.SyncStatus = "已暂停"
		} else {
			s.SyncStatus = "正在恢复同步"
		}
	})
	c.wakeNow()
	return nil
}

func (c *agentController) Logout() error {
	if cfg, err := userconfig.Load(); err == nil {
		if cli, clientErr := userconfig.NewClient(cfg); clientErr == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			_ = cli.LogoutSession(ctx)
			cancel()
		}
	}
	if err := userconfig.Remove(); err != nil {
		return err
	}
	c.setSnapshot(func(s *agentSnapshot) {
		*s = agentSnapshot{
			AuthStatus: "未登录",
			SyncStatus: "等待登录",
			Version:    version.String(),
		}
	})
	c.wakeNow()
	return nil
}

func (c *agentController) OpenFolder() error {
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	root, err := userconfig.EffectiveMountPath(cfg)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	return openFolderPlatform(root)
}

func (c *agentController) CheckUpdate() (string, bool) {
	current := version.String()
	if !xupdate.IsReleaseVersion(current) {
		return "当前是开发/快照版本，不参与稳定版自动更新。", false
	}
	started, result, err := xupdate.InstallLatest(context.Background(), current)
	if err != nil {
		return "检查更新失败：" + err.Error(), false
	}
	if !started {
		return fmt.Sprintf("当前已是最新版本 %s。", current), false
	}
	return fmt.Sprintf("已验证 %s，正在启动更新安装。", result.Latest), true
}

func (c *agentController) Quit() { c.cancel() }

type desiredMount struct {
	key  string
	root string
	cfg  userconfig.Config
}

func loadDesired() (desiredMount, error) {
	cfg, err := userconfig.Load()
	if err != nil {
		return desiredMount{}, err
	}
	root, err := userconfig.EffectiveMountPath(cfg)
	if err != nil {
		return desiredMount{}, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return desiredMount{}, err
	}
	key := cfg.Server + "\x00" + cfg.SessionID + "\x00" + root
	return desiredMount{key: key, root: root, cfg: cfg}, nil
}
