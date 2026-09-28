package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	xupdate "github.com/lazyxu/xdrive/internal/update"
	"github.com/lazyxu/xdrive/internal/userconfig"
	"github.com/lazyxu/xdrive/internal/version"
)

const (
	clientUpdateStatusIdle      = "idle"
	clientUpdateStatusChecking  = "checking"
	clientUpdateStatusAvailable = "available"
	clientUpdateStatusCurrent   = "up_to_date"
	clientUpdateStatusDownload  = "downloading"
	clientUpdateStatusReady     = "downloaded"
	clientUpdateStatusInstall   = "installing"
	clientUpdateStatusError     = "error"

	clientUpdateInitialDelay = 90 * time.Second
	clientUpdateInterval     = 6 * time.Hour
)

var (
	errClientUpdateBusy           = errors.New("client update operation is already running")
	errClientUpdateNotCancellable = errors.New("client update operation is not cancellable")
)

type clientUpdateState struct {
	Mode             string  `json:"mode"`
	Source           string  `json:"source"`
	Status           string  `json:"status"`
	CurrentVersion   string  `json:"current_version"`
	LatestVersion    string  `json:"latest_version,omitempty"`
	ReleaseName      string  `json:"release_name,omitempty"`
	PublishedAt      string  `json:"published_at,omitempty"`
	ReleaseNotes     string  `json:"release_notes,omitempty"`
	ReleaseURL       string  `json:"release_url,omitempty"`
	Channel          string  `json:"channel,omitempty"`
	UpdateAvailable  bool    `json:"update_available"`
	Downloaded       bool    `json:"downloaded"`
	InstallSupported bool    `json:"install_supported"`
	LastCheckedAt    string  `json:"last_checked_at,omitempty"`
	Message          string  `json:"message,omitempty"`
	LastError        string  `json:"last_error,omitempty"`
	BytesDone        int64   `json:"bytes_done,omitempty"`
	BytesTotal       int64   `json:"bytes_total,omitempty"`
	BytesPerSecond   float64 `json:"bytes_per_second,omitempty"`
}

type clientUpdateBackend interface {
	Target(current string) (channel string, err error)
	Check(context.Context, string, string, string) (xupdate.Result, error)
	Download(context.Context, xupdate.Result, xupdate.ProgressFunc) (string, error)
	Install(context.Context, string, string, string, xupdate.ProgressFunc) (bool, xupdate.Result, error)
}

type defaultClientUpdateBackend struct{}

func (defaultClientUpdateBackend) Target(current string) (string, error) {
	return xupdate.AutomaticChannel(current)
}

func (defaultClientUpdateBackend) Check(ctx context.Context, current, channel, source string) (xupdate.Result, error) {
	return xupdate.CheckPlatformTargetFromSource(ctx, current, channel, source)
}

func (defaultClientUpdateBackend) Download(ctx context.Context, result xupdate.Result, progress xupdate.ProgressFunc) (string, error) {
	cache, err := os.UserCacheDir()
	if err != nil {
		cache = os.TempDir()
	}
	dir := filepath.Join(cache, "xdrive", "updates", result.Latest)
	return xupdate.DownloadVerifiedWithProgress(ctx, xupdate.DefaultChecker(), result, dir, progress)
}

func (defaultClientUpdateBackend) Install(ctx context.Context, current, channel, source string, progress xupdate.ProgressFunc) (bool, xupdate.Result, error) {
	return xupdate.InstallTargetFromSourceWithProgress(ctx, current, channel, source, progress)
}

type clientUpdateManager struct {
	ctx     context.Context
	backend clientUpdateBackend

	mu       sync.RWMutex
	state    clientUpdateState
	wake     chan struct{}
	op       chan struct{}
	install  chan struct{}
	opMu     sync.Mutex
	opCancel context.CancelFunc
}

func newClientUpdateManager(ctx context.Context) *clientUpdateManager {
	return newClientUpdateManagerWithBackend(ctx, defaultClientUpdateBackend{})
}

func newClientUpdateManagerWithBackend(ctx context.Context, backend clientUpdateBackend, installCapability ...bool) *clientUpdateManager {
	mode := userconfig.UpdateModeManual
	source := userconfig.UpdateSourceGitHub
	lastError := ""
	installSupported := runtime.GOOS == "windows"
	if len(installCapability) > 0 {
		installSupported = installCapability[0]
	}
	if prefs, err := userconfig.LoadUpdatePreferences(); err == nil {
		mode = prefs.Mode
		source = prefs.Source
	} else {
		lastError = err.Error()
	}
	if mode == userconfig.UpdateModeInstall && !installSupported {
		mode = userconfig.UpdateModeManual
		if err := userconfig.SaveUpdatePreferences(userconfig.UpdatePreferences{Mode: mode, Source: source}); err != nil && lastError == "" {
			lastError = err.Error()
		}
	}
	return &clientUpdateManager{
		ctx:     ctx,
		backend: backend,
		state: clientUpdateState{
			Mode:             mode,
			Source:           source,
			Status:           clientUpdateStatusIdle,
			CurrentVersion:   version.String(),
			InstallSupported: installSupported,
			LastError:        lastError,
		},
		wake:    make(chan struct{}, 1),
		op:      make(chan struct{}, 1),
		install: make(chan struct{}, 1),
	}
}

func (m *clientUpdateManager) Snapshot() clientUpdateState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state
}

func (m *clientUpdateManager) InstallStarted() <-chan struct{} {
	return m.install
}

func (m *clientUpdateManager) SetMode(mode string) (clientUpdateState, error) {
	mode, err := userconfig.NormalizeUpdateMode(mode)
	if err != nil {
		return m.Snapshot(), err
	}
	if mode == userconfig.UpdateModeInstall && !m.Snapshot().InstallSupported {
		return m.Snapshot(), fmt.Errorf("当前平台不支持后台自动安装；可使用自动下载后通过系统包管理器安装")
	}
	current := m.Snapshot()
	if err := userconfig.SaveUpdatePreferences(userconfig.UpdatePreferences{Mode: mode, Source: current.Source}); err != nil {
		return current, err
	}
	m.mu.Lock()
	m.state.Mode = mode
	m.state.LastError = ""
	m.mu.Unlock()
	if mode != userconfig.UpdateModeManual {
		select {
		case m.wake <- struct{}{}:
		default:
		}
	}
	return m.Snapshot(), nil
}

func (m *clientUpdateManager) SetSource(source string) (clientUpdateState, error) {
	source, err := userconfig.NormalizeUpdateSource(source)
	if err != nil {
		return m.Snapshot(), err
	}
	current := m.Snapshot()
	if current.Source == source {
		return current, nil
	}
	if err := userconfig.SaveUpdatePreferences(userconfig.UpdatePreferences{Mode: current.Mode, Source: source}); err != nil {
		return current, err
	}
	m.mu.Lock()
	m.state.Source = source
	m.state.Status = clientUpdateStatusIdle
	m.state.LatestVersion = ""
	m.state.ReleaseName = ""
	m.state.PublishedAt = ""
	m.state.ReleaseNotes = ""
	m.state.ReleaseURL = ""
	m.state.Channel = ""
	m.state.UpdateAvailable = false
	m.state.Downloaded = false
	m.state.LastCheckedAt = ""
	m.state.Message = ""
	m.state.LastError = ""
	m.state.BytesDone = 0
	m.state.BytesTotal = 0
	m.state.BytesPerSecond = 0
	m.mu.Unlock()
	return m.Snapshot(), nil
}

func (m *clientUpdateManager) Run() {
	timer := time.NewTimer(clientUpdateInitialDelay)
	defer timer.Stop()
	reset := func(delay time.Duration) {
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(delay)
	}
	for {
		select {
		case <-m.ctx.Done():
			return
		case <-m.wake:
			m.runConfiguredMode()
			reset(clientUpdateInterval)
		case <-timer.C:
			m.runConfiguredMode()
			timer.Reset(clientUpdateInterval)
		}
	}
}

func (m *clientUpdateManager) runConfiguredMode() {
	mode := m.Snapshot().Mode
	switch mode {
	case userconfig.UpdateModeCheck:
		_, _ = m.Check(m.ctx)
	case userconfig.UpdateModeDownload:
		_, _ = m.Download(m.ctx)
	case userconfig.UpdateModeInstall:
		_, _ = m.Install(m.ctx)
	}
}

func (m *clientUpdateManager) Check(ctx context.Context) (clientUpdateState, error) {
	opCtx, ok := m.beginOperation(ctx)
	if !ok {
		return m.Snapshot(), errClientUpdateBusy
	}
	defer m.endOperation()

	channel, err := m.target()
	if err != nil {
		return m.fail(err)
	}
	source := m.Snapshot().Source
	m.setOperation(clientUpdateStatusChecking, "正在检查更新…", channel)
	result, err := m.backend.Check(opCtx, version.String(), channel, source)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return m.cancelled()
		}
		return m.failChecked(err)
	}
	return m.applyCheckResult(result), nil
}

func (m *clientUpdateManager) Download(ctx context.Context) (clientUpdateState, error) {
	opCtx, ok := m.beginOperation(ctx)
	if !ok {
		return m.Snapshot(), errClientUpdateBusy
	}
	defer m.endOperation()

	channel, err := m.target()
	if err != nil {
		return m.fail(err)
	}
	source := m.Snapshot().Source
	m.setOperation(clientUpdateStatusChecking, "正在检查更新…", channel)
	result, err := m.backend.Check(opCtx, version.String(), channel, source)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return m.cancelled()
		}
		return m.failChecked(err)
	}
	m.markChecked(result)
	if !result.UpdateAvailable {
		return m.applyCheckResult(result), nil
	}

	m.mu.Lock()
	m.state.Status = clientUpdateStatusDownload
	m.state.Message = "正在下载并校验更新…"
	m.state.LastError = ""
	m.state.BytesDone = 0
	m.state.BytesTotal = result.Asset.Size
	m.state.BytesPerSecond = 0
	m.mu.Unlock()

	path, err := m.backend.Download(opCtx, result, m.progress)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return m.cancelled()
		}
		return m.fail(err)
	}
	if path == "" {
		return m.fail(fmt.Errorf("update download completed without a cached installer"))
	}
	m.mu.Lock()
	m.state.Status = clientUpdateStatusReady
	m.state.UpdateAvailable = true
	m.state.Downloaded = true
	m.state.Message = "更新已下载并通过校验，等待安装。"
	m.state.LastError = ""
	m.state.BytesDone = m.state.BytesTotal
	m.mu.Unlock()
	return m.Snapshot(), nil
}

func (m *clientUpdateManager) Install(ctx context.Context) (clientUpdateState, error) {
	if !m.Snapshot().InstallSupported {
		return m.Snapshot(), fmt.Errorf("当前平台不支持后台自动安装；请下载更新后使用系统包管理器安装")
	}
	opCtx, ok := m.beginOperation(ctx)
	if !ok {
		return m.Snapshot(), errClientUpdateBusy
	}
	defer m.endOperation()

	channel, err := m.target()
	if err != nil {
		return m.fail(err)
	}
	source := m.Snapshot().Source
	m.setOperation(clientUpdateStatusChecking, "正在检查更新…", channel)
	started, result, err := m.backend.Install(opCtx, version.String(), channel, source, m.progress)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return m.cancelled()
		}
		return m.failChecked(err)
	}
	m.markChecked(result)
	if !started {
		return m.applyCheckResult(result), nil
	}
	m.mu.Lock()
	m.state.Status = clientUpdateStatusInstall
	m.state.UpdateAvailable = true
	m.state.Downloaded = true
	m.state.Message = "更新安装已启动，客户端将完成验证并重启。"
	m.state.LastError = ""
	m.mu.Unlock()
	// Give the Desktop IPC response a brief chance to return before the
	// controller shuts down the Agent for the detached installer transaction.
	go func() {
		timer := time.NewTimer(250 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-m.ctx.Done():
			return
		case <-timer.C:
		}
		select {
		case m.install <- struct{}{}:
		default:
		}
	}()
	return m.Snapshot(), nil
}

func (m *clientUpdateManager) target() (string, error) {
	channel, err := m.backend.Target(version.String())
	if err != nil {
		return "", err
	}
	if channel == "" {
		return "", fmt.Errorf("当前构建未绑定更新通道")
	}
	return channel, nil
}

func (m *clientUpdateManager) Cancel() (clientUpdateState, error) {
	state := m.Snapshot()
	if state.Status != clientUpdateStatusChecking && state.Status != clientUpdateStatusDownload {
		return state, errClientUpdateNotCancellable
	}
	m.opMu.Lock()
	cancel := m.opCancel
	m.opMu.Unlock()
	if cancel == nil {
		return state, errClientUpdateNotCancellable
	}
	cancel()
	return m.cancelled()
}

func (m *clientUpdateManager) beginOperation(parent context.Context) (context.Context, bool) {
	if !m.acquire() {
		return nil, false
	}
	ctx, cancel := context.WithCancel(parent)
	m.opMu.Lock()
	m.opCancel = cancel
	m.opMu.Unlock()
	return ctx, true
}

func (m *clientUpdateManager) endOperation() {
	m.opMu.Lock()
	if m.opCancel != nil {
		m.opCancel()
		m.opCancel = nil
	}
	m.opMu.Unlock()
	m.release()
}

func (m *clientUpdateManager) cancelled() (clientUpdateState, error) {
	m.mu.Lock()
	if m.state.UpdateAvailable {
		m.state.Status = clientUpdateStatusAvailable
	} else {
		m.state.Status = clientUpdateStatusIdle
	}
	m.state.Message = "更新操作已取消。"
	m.state.LastError = ""
	m.state.BytesPerSecond = 0
	m.mu.Unlock()
	return m.Snapshot(), nil
}

func (m *clientUpdateManager) acquire() bool {
	select {
	case m.op <- struct{}{}:
		return true
	default:
		return false
	}
}

func (m *clientUpdateManager) release() {
	<-m.op
}

func (m *clientUpdateManager) setOperation(status, message, channel string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state.Status = status
	m.state.Channel = channel
	m.state.Message = message
	m.state.LastError = ""
	m.state.BytesDone = 0
	m.state.BytesTotal = 0
	m.state.BytesPerSecond = 0
}

func (m *clientUpdateManager) markChecked(result xupdate.Result) {
	now := time.Now().UTC().Format(time.RFC3339)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state.LatestVersion != "" && m.state.LatestVersion != result.Latest {
		m.state.Downloaded = false
	}
	m.state.Channel = result.Channel
	m.state.LatestVersion = result.Latest
	m.state.ReleaseName = result.ReleaseName
	m.state.PublishedAt = result.PublishedAt
	m.state.ReleaseNotes = result.ReleaseNotes
	m.state.ReleaseURL = result.ReleaseURL
	m.state.UpdateAvailable = result.UpdateAvailable
	m.state.LastCheckedAt = now
	if !result.UpdateAvailable {
		m.state.Downloaded = false
	}
}

func (m *clientUpdateManager) applyCheckResult(result xupdate.Result) clientUpdateState {
	m.markChecked(result)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state.LastError = ""
	m.state.BytesDone = 0
	m.state.BytesTotal = result.Asset.Size
	m.state.BytesPerSecond = 0
	if result.UpdateAvailable {
		if m.state.Downloaded {
			m.state.Status = clientUpdateStatusReady
			m.state.Message = "更新已下载并通过校验，等待安装。"
		} else {
			m.state.Status = clientUpdateStatusAvailable
			m.state.Message = fmt.Sprintf("发现新版本 %s。", result.Latest)
		}
	} else {
		m.state.Status = clientUpdateStatusCurrent
		m.state.Message = "当前已是最新版本。"
	}
	return m.state
}

func (m *clientUpdateManager) failChecked(err error) (clientUpdateState, error) {
	m.mu.Lock()
	m.state.LastCheckedAt = time.Now().UTC().Format(time.RFC3339)
	m.mu.Unlock()
	return m.fail(err)
}

func (m *clientUpdateManager) fail(err error) (clientUpdateState, error) {
	m.mu.Lock()
	m.state.Status = clientUpdateStatusError
	m.state.Message = ""
	m.state.LastError = err.Error()
	m.mu.Unlock()
	return m.Snapshot(), err
}

func (m *clientUpdateManager) progress(event xupdate.ProgressEvent) {
	m.mu.Lock()
	defer m.mu.Unlock()
	switch {
	case event.Step <= 1:
		m.state.Status = clientUpdateStatusChecking
	case event.Step >= 5:
		m.state.Status = clientUpdateStatusInstall
	default:
		m.state.Status = clientUpdateStatusDownload
	}
	if event.Message != "" {
		m.state.Message = event.Message
	} else if event.Stage != "" {
		m.state.Message = event.Stage
	}
	m.state.BytesDone = event.Current
	m.state.BytesTotal = event.Total
	m.state.BytesPerSecond = event.BytesPerSecond
	m.state.LastError = ""
}
