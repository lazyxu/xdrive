package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/conflictstate"
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
	ConflictCount      int
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

	mu               sync.RWMutex
	snap             agentSnapshot
	snapshotRevision uint64
	snapshotChanged  chan struct{}
}

func newAgentController(ctx context.Context, cancel context.CancelFunc) *agentController {
	return &agentController{
		ctx:              ctx,
		cancel:           cancel,
		wake:             make(chan struct{}, 1),
		notifications:    make(chan agentNotification, 16),
		snapshotRevision: 1,
		snapshotChanged:  make(chan struct{}),
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
	snapshot, _ := c.SnapshotWithRevision()
	return snapshot
}

func (c *agentController) SnapshotWithRevision() (agentSnapshot, uint64) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.snap, c.snapshotRevision
}

func (c *agentController) WaitSnapshot(ctx context.Context, after uint64) (agentSnapshot, uint64, bool) {
	for {
		c.mu.RLock()
		snapshot := c.snap
		revision := c.snapshotRevision
		changed := c.snapshotChanged
		c.mu.RUnlock()

		if revision != after {
			return snapshot, revision, true
		}
		select {
		case <-ctx.Done():
			return snapshot, revision, false
		case <-changed:
		}
	}
}

func (c *agentController) setSnapshot(fn func(*agentSnapshot)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	before := c.snap
	fn(&c.snap)
	if c.snap == before {
		return
	}
	if c.snapshotChanged == nil {
		c.snapshotChanged = make(chan struct{})
	}
	c.snapshotRevision++
	close(c.snapshotChanged)
	c.snapshotChanged = make(chan struct{})
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
		switch event.Kind {
		case mount.EventSyncStarted:
			c.setSnapshot(func(s *agentSnapshot) {
				if !s.HasConflict {
					s.SyncStatus = "正在同步"
				}
			})
		case mount.EventSyncCompleted:
			notifyComplete := false
			c.setSnapshot(func(s *agentSnapshot) {
				if !s.HasConflict {
					notifyComplete = s.SyncStatus == "正在同步"
					s.SyncStatus = "同步正常"
					s.LastError = ""
				}
			})
			if notifyComplete && event.Notify {
				c.notify(agentNotification{Title: "xDrive", Body: "同步完成", Kind: "info"})
			}
		case mount.EventSyncFailed:
			c.setSnapshot(func(s *agentSnapshot) {
				if !s.HasConflict {
					s.SyncStatus = "同步错误"
				}
				s.LastError = event.Message
			})
		case mount.EventConflict:
			snapshot := c.Snapshot()
			stored := false
			if dir, err := userconfig.Dir(); err == nil {
				if err := conflictstate.Upsert(dir, conflictstate.Record{
					ID:             event.Path,
					Server:         snapshot.Server,
					Username:       snapshot.Username,
					OriginalPath:   event.OriginalPath,
					ConflictPath:   event.Path,
					OriginalNodeID: event.OriginalNodeID,
					ConflictNodeID: event.ConflictNodeID,
					CreatedAt:      time.Now().UTC(),
				}); err == nil {
					stored = true
				}
			}
			if stored {
				c.refreshConflictSnapshot()
			} else {
				c.setSnapshot(func(s *agentSnapshot) {
					s.HasConflict = true
					if s.ConflictCount == 0 {
						s.ConflictCount = 1
					}
				})
			}
			c.setSnapshot(func(s *agentSnapshot) {
				s.SyncStatus = "存在冲突副本"
			})
			body := "已保留冲突副本"
			if event.Path != "" {
				body += "：" + event.Path
			}
			c.notify(agentNotification{Title: "xDrive 冲突", Body: body, Kind: "warning"})
		}
	})
	defer mount.SetEventSink(nil)

	var (
		running        bool
		currentKey     string
		mountCancel    context.CancelFunc
		mountDone      chan error
		lastAuthCheck  time.Time
		lastAuthNotice string
		conflictKey    string
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
			s.SyncStatus = "正在启动同步"
			s.LastError = ""
		})
		go func() {
			done <- mount.RunWithOptions(mctx, cli, d.root, mountOptionsFromConfig(d.cfg))
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
			lastAuthNotice = ""
			conflictKey = ""
			c.setSnapshot(func(s *agentSnapshot) {
				s.HasConflict = false
				s.ConflictCount = 0
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

		nextConflictKey := d.cfg.Server + "\x00" + d.cfg.Username
		if nextConflictKey != conflictKey {
			conflictKey = nextConflictKey
			c.refreshConflictSnapshot()
		}

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
				lastAuthNotice = ""
				c.setSnapshot(func(s *agentSnapshot) {
					s.AuthStatus = "已登录"
					if !s.HasConflict {
						s.SyncStatus = "同步正常"
					}
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
					if lastAuthNotice != "invalid" {
						lastAuthNotice = "invalid"
						c.notify(agentNotification{Title: "xDrive", Body: "登录已失效，请重新登录。", Kind: "warning"})
					}
					return
				}
				if apiErr.Status == 401 || apiErr.Status == 403 {
					stopMount()
					c.setSnapshot(func(s *agentSnapshot) {
						s.AuthStatus = "登录已过期"
						s.SyncStatus = "需要重新登录"
						s.LastError = err.Error()
					})
					if lastAuthNotice != "invalid" {
						lastAuthNotice = "invalid"
						c.notify(agentNotification{Title: "xDrive", Body: "登录已失效，请重新登录。", Kind: "warning"})
					}
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
				if lastAuthNotice != "invalid" {
					lastAuthNotice = "invalid"
					c.notify(agentNotification{Title: "xDrive", Body: "登录已失效，请重新登录。", Kind: "warning"})
				}
				return
			}
			c.setSnapshot(func(s *agentSnapshot) {
				s.AuthStatus = "已登录"
				s.SyncStatus = "连接失败"
				s.LastError = err.Error()
			})
			return
		}

		lastAuthNotice = ""
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
	var syncRules []userconfig.SyncRule
	var cacheLimitBytes int64
	if old, loadErr := userconfig.Load(); loadErr == nil {
		if mountPath == "" {
			mountPath = old.MountPath
		}
		sessionID = old.SessionID
		cacheLimitBytes = old.CacheLimitBytes
		if strings.EqualFold(strings.TrimRight(old.Server, "/"), server) && old.Username == resp.Username {
			syncRules = append([]userconfig.SyncRule(nil), old.SyncRules...)
		}
	}
	cfg := userconfig.Config{
		Server:          server,
		MountPath:       mountPath,
		SessionID:       sessionID,
		Paused:          false,
		SyncRules:       syncRules,
		CacheLimitBytes: cacheLimitBytes,
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
	c.refreshConflictSnapshot()
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

func (c *agentController) Settings() (userconfig.Config, string, error) {
	cfg, err := userconfig.Load()
	if err != nil {
		return userconfig.Config{}, "", err
	}
	root, err := userconfig.EffectiveMountPath(cfg)
	if err != nil {
		return cfg, "", err
	}
	return cfg, root, nil
}

func (c *agentController) UpdateSettings(mountPath *string, cacheLimitBytes *int64) error {
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	if mountPath != nil {
		path := strings.TrimSpace(*mountPath)
		if path == "" {
			return fmt.Errorf("同步目录不能为空")
		}
		abs, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		cfg.MountPath = filepath.Clean(abs)
	}
	if cacheLimitBytes != nil {
		if *cacheLimitBytes < 0 || *cacheLimitBytes > 16<<40 {
			return fmt.Errorf("缓存上限必须是 0–16 TiB；0 表示不限制")
		}
		cfg.CacheLimitBytes = *cacheLimitBytes
	}
	if err := userconfig.Save(cfg); err != nil {
		return err
	}
	c.wakeNow()
	return nil
}

func (c *agentController) SaveMountPath(path string) error {
	return c.UpdateSettings(&path, nil)
}

func mountOptionsFromConfig(cfg userconfig.Config) mount.Options {
	opts := mount.Options{CacheLimitBytes: cfg.CacheLimitBytes}
	for _, rule := range cfg.SyncRules {
		switch rule.Mode {
		case userconfig.SyncModeExclude:
			opts.ExcludedPaths = append(opts.ExcludedPaths, rule.Path)
		case userconfig.SyncModeAlwaysLocal:
			opts.AlwaysLocalPaths = append(opts.AlwaysLocalPaths, rule.Path)
		}
	}
	return opts
}

func (c *agentController) SetSelectiveSyncRule(path, mode string) error {
	cfg, root, abs, err := managedPath(path)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil {
		return err
	}
	rel = filepath.ToSlash(rel)
	if rel == "." || rel == "" {
		return fmt.Errorf("不能对整个 xDrive 根目录设置选择性同步规则")
	}
	rel, err = userconfig.NormalizeSyncRulePath(rel)
	if err != nil {
		return err
	}

	mode = strings.TrimSpace(mode)
	if mode != "" && mode != "default" &&
		mode != userconfig.SyncModeExclude && mode != userconfig.SyncModeAlwaysLocal {
		return fmt.Errorf("未知的选择性同步模式")
	}

	canonical := rel
	if mode != "" && mode != "default" {
		ctx, cancel := context.WithTimeout(c.ctx, 30*time.Second)
		defer cancel()
		cli, err := userconfig.NewClient(cfg)
		if err != nil {
			return err
		}
		remote, err := cli.Walk(ctx)
		if err != nil {
			return err
		}
		remotePath, node, ok := findRemotePathFold(remote, rel)
		if !ok || node.Type != "dir" {
			return fmt.Errorf("选择性同步规则只能应用到已存在的云端目录")
		}
		canonical = remotePath
		if mode == userconfig.SyncModeExclude {
			if err := validateExcludedDirectory(root, abs, remote); err != nil {
				return err
			}
		}
	}

	next := make([]userconfig.SyncRule, 0, len(cfg.SyncRules)+1)
	for _, rule := range cfg.SyncRules {
		if strings.EqualFold(rule.Path, rel) || strings.EqualFold(rule.Path, canonical) {
			continue
		}
		next = append(next, rule)
	}
	if mode != "" && mode != "default" {
		next = append(next, userconfig.SyncRule{Path: canonical, Mode: mode})
	}
	cfg.SyncRules = next
	if err := userconfig.Save(cfg); err != nil {
		return err
	}
	c.wakeNow()
	return nil
}

func (c *agentController) SetCacheLimitGiB(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		value = "0"
	}
	gib, err := strconv.ParseFloat(value, 64)
	if err != nil || gib < 0 || gib > 16384 {
		return fmt.Errorf("缓存上限必须是 0–16384 GiB；0 表示不限制")
	}
	bytes := int64(gib * float64(int64(1)<<30))
	return c.UpdateSettings(nil, &bytes)
}

func findRemotePathFold(remote map[string]client.Node, rel string) (string, client.Node, bool) {
	for path, node := range remote {
		if strings.EqualFold(path, rel) {
			return path, node, true
		}
	}
	return "", client.Node{}, false
}

func validateExcludedDirectory(root, abs string, remote map[string]client.Node) error {
	if _, err := os.Lstat(abs); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	return filepath.WalkDir(abs, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		_, remoteNode, ok := findRemotePathFold(remote, rel)
		if !ok {
			return fmt.Errorf("%s 仅存在于本机；请先完成同步再排除此目录", path)
		}
		if entry.IsDir() != (remoteNode.Type == "dir") {
			return fmt.Errorf("%s 与云端对象类型不一致", path)
		}
		if entry.IsDir() {
			return nil
		}
		state, err := mount.Availability(path)
		if err != nil {
			return err
		}
		if !state.Placeholder || !state.InSync {
			return fmt.Errorf("%s 尚未安全同步到云端；请先立即同步", path)
		}
		return nil
	})
}

func (c *agentController) SetPaused(paused bool) error {
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	cfg.Paused = paused
	if err := userconfig.Save(cfg); err != nil {
		return err
	}
	c.setSnapshot(func(s *agentSnapshot) {
		s.Paused = paused
		if paused {
			s.SyncStatus = "已暂停"
		} else {
			s.SyncStatus = "正在恢复同步"
		}
	})
	c.wakeNow()
	return nil
}

func (c *agentController) TogglePause() error {
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	return c.SetPaused(!cfg.Paused)
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
	channel, commit, err := xupdate.AutomaticTarget(current)
	if err != nil {
		return "检查更新失败：" + err.Error(), false
	}
	if channel == "" {
		return "当前开发构建未绑定自动更新通道；可使用 xd update --channel master 手动切换。", false
	}
	started, result, err := xupdate.InstallTarget(context.Background(), current, channel, commit)
	if err != nil {
		return "检查更新失败：" + err.Error(), false
	}
	if !started {
		return fmt.Sprintf("当前已是 %s 通道最新版本 %s。", channel, current), false
	}
	return fmt.Sprintf("已验证 %s 通道的 %s，正在启动更新安装。", channel, result.Latest), true
}

func (c *agentController) SyncNow() error {
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	root, err := userconfig.EffectiveMountPath(cfg)
	if err != nil {
		return err
	}
	if !mount.RequestSync(root) {
		return fmt.Errorf("同步引擎当前未运行，请先登录并恢复同步")
	}
	c.setSnapshot(func(s *agentSnapshot) {
		if !s.HasConflict {
			s.SyncStatus = "正在同步"
		}
	})
	return nil
}

func (c *agentController) FileAvailability(path string) (mount.FileAvailability, error) {
	_, _, abs, err := managedPath(path)
	if err != nil {
		return mount.FileAvailability{}, err
	}
	return mount.Availability(abs)
}

func (c *agentController) SetFileAvailability(path, action string) error {
	_, root, abs, err := managedPath(path)
	if err != nil {
		return err
	}
	switch strings.TrimSpace(action) {
	case "keep":
		err = mount.KeepLocal(abs)
	case "release":
		err = mount.ReleaseSpace(abs)
	case "online":
		err = mount.MakeOnlineOnly(abs)
	case "sync":
		return c.SyncNow()
	default:
		return fmt.Errorf("未知的文件状态操作")
	}
	if err != nil {
		return err
	}
	_ = mount.RequestSync(root)
	return nil
}

func managedPath(path string) (userconfig.Config, string, string, error) {
	cfg, err := userconfig.Load()
	if err != nil {
		return userconfig.Config{}, "", "", err
	}
	root, err := userconfig.EffectiveMountPath(cfg)
	if err != nil {
		return cfg, "", "", err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return cfg, "", "", err
	}
	path = strings.TrimSpace(path)
	if path == "" {
		path = root
	} else if !filepath.IsAbs(path) {
		path = filepath.Join(root, path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return cfg, root, "", err
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil {
		return cfg, root, "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return cfg, root, "", fmt.Errorf("路径必须位于 xDrive 同步目录内")
	}
	return cfg, filepath.Clean(root), filepath.Clean(abs), nil
}

func (c *agentController) Conflicts() []conflictstate.Record {
	cfg, err := userconfig.Load()
	if err != nil {
		return nil
	}
	dir, err := userconfig.Dir()
	if err != nil {
		return nil
	}
	items, err := conflictstate.List(dir)
	if err != nil {
		return nil
	}
	out := make([]conflictstate.Record, 0, len(items))
	for _, item := range items {
		if strings.EqualFold(strings.TrimRight(item.Server, "/"), strings.TrimRight(cfg.Server, "/")) &&
			item.Username == cfg.Username {
			out = append(out, item)
		}
	}
	return out
}

func (c *agentController) refreshConflictSnapshot() {
	items := c.Conflicts()
	c.setSnapshot(func(s *agentSnapshot) {
		s.ConflictCount = len(items)
		s.HasConflict = len(items) > 0
		if len(items) == 0 && s.SyncStatus == "存在冲突副本" {
			s.SyncStatus = "同步正常"
		}
	})
}

func (c *agentController) OpenConflict(id string, both bool) error {
	record, root, err := c.conflictByID(id)
	if err != nil {
		return err
	}
	original := filepath.Join(root, filepath.FromSlash(record.OriginalPath))
	conflict := filepath.Join(root, filepath.FromSlash(record.ConflictPath))
	if both {
		if err := openFilePlatform(original); err != nil {
			return err
		}
		return openFilePlatform(conflict)
	}
	return selectFilePlatform(conflict)
}

func (c *agentController) ResolveConflict(id, choice string) error {
	record, root, err := c.conflictByID(id)
	if err != nil {
		return err
	}
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	cli, err := userconfig.NewClient(cfg)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(c.ctx, 2*time.Minute)
	defer cancel()
	if err := applyConflictChoice(ctx, cli, root, record, choice); err != nil {
		return err
	}

	conflictAbs := filepath.Join(root, filepath.FromSlash(record.ConflictPath))
	_ = os.Remove(conflictAbs)
	if dir, dirErr := userconfig.Dir(); dirErr == nil {
		if err := conflictstate.Remove(dir, record.ID); err != nil {
			return err
		}
	}
	c.refreshConflictSnapshot()
	_ = mount.RequestSync(root)
	return nil
}

func (c *agentController) conflictByID(id string) (conflictstate.Record, string, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return conflictstate.Record{}, "", fmt.Errorf("冲突记录不能为空")
	}
	cfg, err := userconfig.Load()
	if err != nil {
		return conflictstate.Record{}, "", err
	}
	root, err := userconfig.EffectiveMountPath(cfg)
	if err != nil {
		return conflictstate.Record{}, "", err
	}
	for _, item := range c.Conflicts() {
		if item.ID == id {
			return item, root, nil
		}
	}
	return conflictstate.Record{}, root, fmt.Errorf("冲突记录不存在或已解决")
}

func findConflictNode(remote map[string]client.Node, path string, id uint64) (client.Node, bool) {
	key := filepath.ToSlash(filepath.Clean(path))
	if n, ok := remote[key]; ok && (id == 0 || n.ID == id) {
		return n, true
	}
	if id != 0 {
		for _, n := range remote {
			if n.ID == id {
				return n, true
			}
		}
	}
	return client.Node{}, false
}

func isNotFound(err error) bool {
	var apiErr *client.APIError
	return errors.As(err, &apiErr) && apiErr.Status == 404
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
	key := cfg.Server + "\x00" + cfg.SessionID + "\x00" + root + "\x00" + cfg.StoragePolicyKey()
	return desiredMount{key: key, root: root, cfg: cfg}, nil
}
