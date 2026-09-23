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
	Configured bool
	Username   string
	Server     string
	MountPath  string
	AuthStatus string
	SyncStatus string
	Paused     bool
	LastError  string
	Version    string
}

type agentController struct {
	ctx    context.Context
	cancel context.CancelFunc
	wake   chan struct{}

	mu   sync.RWMutex
	snap agentSnapshot
}

func newAgentController(ctx context.Context, cancel context.CancelFunc) *agentController {
	return &agentController{
		ctx:    ctx,
		cancel: cancel,
		wake:   make(chan struct{}, 1),
		snap: agentSnapshot{
			AuthStatus: "未登录",
			SyncStatus: "等待登录",
			Version:    version.String(),
		},
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
		go func() {
			done <- mount.Run(mctx, userconfig.NewClient(d.cfg), d.root)
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
			if s.AuthStatus == "未登录" {
				s.AuthStatus = "已登录"
			}
		})

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
			_, err := userconfig.NewClient(d.cfg).Root(checkCtx)
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
			if errors.As(err, &apiErr) && (apiErr.Status == 401 || apiErr.Status == 403) {
				stopMount()
				c.setSnapshot(func(s *agentSnapshot) {
					s.AuthStatus = "登录已过期"
					s.SyncStatus = "需要重新登录"
					s.LastError = err.Error()
				})
				return
			}
			c.setSnapshot(func(s *agentSnapshot) {
				s.SyncStatus = "网络暂不可用"
				s.LastError = err.Error()
			})
			return
		}

		checkCtx, cancel := context.WithTimeout(c.ctx, 10*time.Second)
		_, err := userconfig.NewClient(d.cfg).Root(checkCtx)
		cancel()
		if err != nil {
			var apiErr *client.APIError
			if errors.As(err, &apiErr) && (apiErr.Status == 401 || apiErr.Status == 403) {
				c.setSnapshot(func(s *agentSnapshot) {
					s.AuthStatus = "登录已过期"
					s.SyncStatus = "需要重新登录"
					s.LastError = err.Error()
				})
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

func (c *agentController) Authenticate(register bool, server, username, password, mountPath string) error {
	server = strings.TrimRight(strings.TrimSpace(server), "/")
	username = strings.TrimSpace(username)
	mountPath = strings.TrimSpace(mountPath)
	if server == "" || username == "" || password == "" {
		return fmt.Errorf("服务器、用户名和密码不能为空")
	}

	ctx, cancel := context.WithTimeout(c.ctx, 30*time.Second)
	defer cancel()
	cli := client.New(server, "")
	var (
		resp client.AuthResponse
		err  error
	)
	if register {
		resp, err = cli.Register(ctx, username, password)
	} else {
		resp, err = cli.Login(ctx, username, password)
	}
	if err != nil {
		return err
	}

	if mountPath == "" {
		if old, loadErr := userconfig.Load(); loadErr == nil {
			mountPath = old.MountPath
		}
	}
	cfg := userconfig.Config{
		Server:    server,
		MountPath: mountPath,
		Paused:    false,
	}
	cfg.ApplyAuth(resp, true)
	if err := userconfig.Save(cfg); err != nil {
		return err
	}
	c.setSnapshot(func(s *agentSnapshot) {
		s.Configured = true
		s.Username = resp.Username
		s.Server = server
		s.AuthStatus = "已登录"
		s.SyncStatus = "正在启动同步"
		s.Paused = false
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
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		_ = userconfig.NewClient(cfg).LogoutSession(ctx)
		cancel()
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
