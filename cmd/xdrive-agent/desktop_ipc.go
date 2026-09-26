package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/conflictstate"
	"github.com/lazyxu/xdrive/internal/diagnostics"
	"github.com/lazyxu/xdrive/internal/mount"
	"github.com/lazyxu/xdrive/internal/transfer"
	"github.com/lazyxu/xdrive/internal/userconfig"
	"github.com/lazyxu/xdrive/internal/version"
)

const (
	desktopIPCAPIVersion       = 1
	desktopIPCProtocolMin      = 1
	desktopIPCProtocolMax      = 1
	desktopIPCDiscoveryName    = "desktop-ipc.json"
	desktopIPCMaxBodyBytes     = 64 << 10
	desktopIPCDefaultEventWait = 25 * time.Second
	desktopIPCMaxEventWait     = 30 * time.Second
)

type desktopIPCDiscovery struct {
	Version int    `json:"version"`
	BaseURL string `json:"base_url"`
	Token   string `json:"token"`
	PID     int    `json:"pid"`
}

type desktopIPCHello struct {
	DiscoveryVersion int      `json:"discovery_version"`
	ProtocolMin      int      `json:"protocol_min"`
	ProtocolMax      int      `json:"protocol_max"`
	AgentVersion     string   `json:"agent_version"`
	PID              int      `json:"pid"`
	Platform         string   `json:"platform"`
	Arch             string   `json:"arch"`
	Capabilities     []string `json:"capabilities"`
}

var desktopIPCCapabilities = []string{
	"status",
	"status-events",
	"auth",
	"sync-control",
	"settings",
	"selective-sync",
	"file-availability",
	"storage-tree",
	"cache-management",
	"cloud-files",
	"external-sources",
	"storage-intelligence",
	"conflicts",
	"transfers",
	"transfer-events",
	"transfer-retry",
	"diagnostics",
	"diagnostic-actions",
	"open-folder",
	"lifecycle-shutdown",
}

type desktopIPCStatus struct {
	Revision           uint64 `json:"revision"`
	Configured         bool   `json:"configured"`
	Username           string `json:"username,omitempty"`
	Server             string `json:"server,omitempty"`
	MountPath          string `json:"mount_path,omitempty"`
	AuthStatus         string `json:"auth_status"`
	SyncStatus         string `json:"sync_status"`
	Paused             bool   `json:"paused"`
	MustChangePassword bool   `json:"must_change_password"`
	LastError          string `json:"last_error,omitempty"`
	HasConflict        bool   `json:"has_conflict"`
	ConflictCount      int    `json:"conflict_count"`
	Version            string `json:"version"`
}

type desktopIPCEvent struct {
	Type     string           `json:"type"`
	Revision uint64           `json:"revision"`
	Status   desktopIPCStatus `json:"status"`
}

type desktopIPCTransfers struct {
	Revision  uint64          `json:"revision"`
	Transfers []transfer.Task `json:"transfers"`
}

type desktopIPCTransferEvent struct {
	Type      string          `json:"type"`
	Revision  uint64          `json:"revision"`
	Transfers []transfer.Task `json:"transfers"`
}

type desktopIPCSettings struct {
	MountPath       string                `json:"mount_path"`
	CacheLimitBytes int64                 `json:"cache_limit_bytes"`
	SyncRules       []userconfig.SyncRule `json:"sync_rules"`
}

type desktopIPCController interface {
	SnapshotWithRevision() (agentSnapshot, uint64)
	WaitSnapshot(context.Context, uint64) (agentSnapshot, uint64, bool)
	Authenticate(server, username, password, mountPath string) error
	ChangePassword(currentPassword, newPassword string) error
	Logout() error
	SetPaused(bool) error
	SyncNow() error
	Settings() (userconfig.Config, string, error)
	UpdateSettings(mountPath *string, cacheLimitBytes *int64) error
	SetSelectiveSyncRule(path, mode string) error
	StorageTree(context.Context) (agentStorageTreeNode, error)
	CacheStats() (mount.CacheStats, error)
	ReleaseReclaimableCache() (mount.CacheReleaseResult, error)
	CloudRoot(context.Context) (client.Node, error)
	CloudList(context.Context, uint64) ([]client.Node, error)
	CloudSearch(context.Context, string) ([]agentCloudSearchResult, error)
	CloudQuota(context.Context) (client.QuotaUsage, error)
	CloudStorageStats(context.Context) (client.StorageStats, error)
	CloudTrash(context.Context) ([]client.Node, error)
	CloudRestoreTrash(context.Context, uint64, uint64) (client.Node, error)
	CloudDeleteTrash(context.Context, uint64, uint64) error
	CloudVersions(context.Context, uint64) ([]client.FileVersion, error)
	CloudRestoreVersion(context.Context, uint64, uint64, uint64) (client.Node, error)
	CloudShares(context.Context, uint64) ([]client.FileShare, error)
	CloudCreateShare(context.Context, uint64, client.CreateShareInput) (agentCreatedShare, error)
	CloudRevokeShare(context.Context, uint64) error
	CloudSources(context.Context) ([]client.Source, error)
	CloudSourceRuns(context.Context, uint64, int) ([]client.SyncRun, error)
	CloudSourceCredentialStatus(context.Context, uint64) (client.SourceCredentialStatus, error)
	FileAvailability(path string) (mount.FileAvailability, error)
	SetFileAvailability(path, action string) error
	Transfers() (uint64, []transfer.Task)
	WaitTransfers(context.Context, uint64) (uint64, []transfer.Task, bool)
	RetryTransfer(context.Context, string) error
	Diagnostics(context.Context) diagnostics.Report
	Reconnect(context.Context) error
	RepairSyncRoot(context.Context) error
	OpenLogs() error
	Conflicts() []conflictstate.Record
	OpenConflict(id string, both bool) error
	ResolveConflict(id, choice string) error
	OpenFolder() error
}

type desktopIPCServer struct {
	server        *http.Server
	discoveryPath string
	token         string
	cleanupOnce   sync.Once
}

func startDesktopIPC(ctx context.Context, ctrl desktopIPCController, shutdown func()) (*desktopIPCServer, error) {
	var tokenBytes [32]byte
	if _, err := rand.Read(tokenBytes[:]); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(tokenBytes[:])

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	baseURL := "http://" + listener.Addr().String()

	configDir, err := userconfig.Dir()
	if err != nil {
		_ = listener.Close()
		return nil, err
	}
	discoveryPath, err := writeDesktopIPCDiscovery(configDir, desktopIPCDiscovery{
		Version: desktopIPCAPIVersion,
		BaseURL: baseURL,
		Token:   token,
		PID:     os.Getpid(),
	})
	if err != nil {
		_ = listener.Close()
		return nil, err
	}

	s := &desktopIPCServer{
		server: &http.Server{
			Handler:           newDesktopIPCHandler(ctrl, token, shutdown),
			ReadHeaderTimeout: 5 * time.Second,
			IdleTimeout:       35 * time.Second,
		},
		discoveryPath: discoveryPath,
		token:         token,
	}

	go func() {
		err := s.server.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("desktop IPC stopped: %v", err)
		}
		s.cleanup()
	}()

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.server.Shutdown(shutdownCtx)
		s.cleanup()
	}()

	return s, nil
}

func (s *desktopIPCServer) Close() error {
	if s == nil || s.server == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := s.server.Shutdown(ctx)
	s.cleanup()
	return err
}

func (s *desktopIPCServer) cleanup() {
	s.cleanupOnce.Do(func() {
		removeDesktopIPCDiscoveryIfOwned(s.discoveryPath, s.token)
	})
}

func writeDesktopIPCDiscovery(configDir string, discovery desktopIPCDiscovery) (string, error) {
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return "", err
	}
	_ = os.Chmod(configDir, 0o700)

	data, err := json.MarshalIndent(discovery, "", "  ")
	if err != nil {
		return "", err
	}
	data = append(data, '\n')

	tmp, err := os.CreateTemp(configDir, "desktop-ipc-*.tmp")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return "", err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return "", err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}

	path := filepath.Join(configDir, desktopIPCDiscoveryName)
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return "", err
	}
	_ = os.Chmod(path, 0o600)
	return path, nil
}

func removeDesktopIPCDiscoveryIfOwned(path, token string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var discovery desktopIPCDiscovery
	if json.Unmarshal(data, &discovery) != nil {
		return
	}
	if subtle.ConstantTimeCompare([]byte(discovery.Token), []byte(token)) != 1 {
		return
	}
	_ = os.Remove(path)
}

func newDesktopIPCHandler(ctrl desktopIPCController, token string, shutdown func()) http.Handler {
	h := &desktopIPCHandler{ctrl: ctrl, shutdown: shutdown}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/hello", h.hello)
	mux.HandleFunc("GET /v1/status", h.status)
	mux.HandleFunc("GET /v1/events", h.events)
	mux.HandleFunc("POST /v1/auth/login", h.login)
	mux.HandleFunc("POST /v1/auth/logout", h.logout)
	mux.HandleFunc("POST /v1/auth/change-password", h.changePassword)
	mux.HandleFunc("POST /v1/sync/pause", h.pause)
	mux.HandleFunc("POST /v1/sync/resume", h.resume)
	mux.HandleFunc("POST /v1/sync/now", h.syncNow)
	mux.HandleFunc("GET /v1/settings", h.settings)
	mux.HandleFunc("PATCH /v1/settings", h.updateSettings)
	mux.HandleFunc("PUT /v1/settings/sync-rule", h.setSyncRule)
	mux.HandleFunc("GET /v1/storage-tree", h.storageTree)
	mux.HandleFunc("GET /v1/cache", h.cacheStats)
	mux.HandleFunc("POST /v1/cache/release", h.releaseCache)
	mux.HandleFunc("GET /v1/cloud/root", h.cloudRoot)
	mux.HandleFunc("GET /v1/cloud/children", h.cloudChildren)
	mux.HandleFunc("GET /v1/cloud/search", h.cloudSearch)
	mux.HandleFunc("GET /v1/cloud/quota", h.cloudQuota)
	mux.HandleFunc("GET /v1/cloud/storage-stats", h.cloudStorageStats)
	mux.HandleFunc("GET /v1/cloud/trash", h.cloudTrash)
	mux.HandleFunc("POST /v1/cloud/trash/restore", h.cloudRestoreTrash)
	mux.HandleFunc("POST /v1/cloud/trash/delete", h.cloudDeleteTrash)
	mux.HandleFunc("GET /v1/cloud/versions", h.cloudVersions)
	mux.HandleFunc("POST /v1/cloud/versions/restore", h.cloudRestoreVersion)
	mux.HandleFunc("GET /v1/cloud/shares", h.cloudShares)
	mux.HandleFunc("POST /v1/cloud/shares", h.cloudCreateShare)
	mux.HandleFunc("POST /v1/cloud/shares/revoke", h.cloudRevokeShare)
	mux.HandleFunc("GET /v1/sources", h.sources)
	mux.HandleFunc("GET /v1/sources/runs", h.sourceRuns)
	mux.HandleFunc("GET /v1/sources/credential", h.sourceCredentialStatus)
	mux.HandleFunc("GET /v1/file-availability", h.fileAvailability)
	mux.HandleFunc("POST /v1/file-availability", h.setFileAvailability)
	mux.HandleFunc("GET /v1/transfers", h.transfers)
	mux.HandleFunc("GET /v1/transfer-events", h.transferEvents)
	mux.HandleFunc("POST /v1/transfers/retry", h.retryTransfer)
	mux.HandleFunc("GET /v1/diagnostics", h.diagnostics)
	mux.HandleFunc("GET /v1/diagnostics/report", h.diagnosticReport)
	mux.HandleFunc("POST /v1/diagnostics/reconnect", h.reconnect)
	mux.HandleFunc("POST /v1/diagnostics/repair-sync-root", h.repairSyncRoot)
	mux.HandleFunc("POST /v1/diagnostics/open-logs", h.openLogs)
	mux.HandleFunc("GET /v1/conflicts", h.conflicts)
	mux.HandleFunc("POST /v1/conflicts/open", h.openConflict)
	mux.HandleFunc("POST /v1/conflicts/resolve", h.resolveConflict)
	mux.HandleFunc("POST /v1/open-folder", h.openFolder)
	mux.HandleFunc("POST /v1/lifecycle/shutdown", h.shutdownAgent)
	return desktopIPCAuth(token, mux)
}

type desktopIPCHandler struct {
	ctrl     desktopIPCController
	shutdown func()
}

func desktopIPCAuth(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		ip := net.ParseIP(host)
		if err != nil || ip == nil || !ip.IsLoopback() {
			writeDesktopIPCError(w, http.StatusForbidden, "loopback_only", "desktop IPC accepts loopback requests only")
			return
		}
		parts := strings.Fields(r.Header.Get("Authorization"))
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") ||
			subtle.ConstantTimeCompare([]byte(parts[1]), []byte(token)) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeDesktopIPCError(w, http.StatusUnauthorized, "unauthorized", "invalid desktop IPC token")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

func (h *desktopIPCHandler) hello(w http.ResponseWriter, _ *http.Request) {
	writeDesktopIPCJSON(w, http.StatusOK, desktopIPCHello{
		DiscoveryVersion: desktopIPCAPIVersion,
		ProtocolMin:      desktopIPCProtocolMin,
		ProtocolMax:      desktopIPCProtocolMax,
		AgentVersion:     version.String(),
		PID:              os.Getpid(),
		Platform:         runtime.GOOS,
		Arch:             runtime.GOARCH,
		Capabilities:     append([]string(nil), desktopIPCCapabilities...),
	})
}

func (h *desktopIPCHandler) shutdownAgent(w http.ResponseWriter, _ *http.Request) {
	if h.shutdown == nil {
		writeDesktopIPCError(w, http.StatusServiceUnavailable, "shutdown_unavailable", "agent shutdown is unavailable")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
	go func() {
		time.Sleep(50 * time.Millisecond)
		h.shutdown()
	}()
}

func (h *desktopIPCHandler) status(w http.ResponseWriter, _ *http.Request) {
	snapshot, revision := h.ctrl.SnapshotWithRevision()
	writeDesktopIPCJSON(w, http.StatusOK, makeDesktopIPCStatus(snapshot, revision))
}

func (h *desktopIPCHandler) events(w http.ResponseWriter, r *http.Request) {
	after := uint64(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("after_revision")); raw != "" {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_after_revision", "after_revision must be an unsigned integer")
			return
		}
		after = value
	}

	wait := desktopIPCDefaultEventWait
	if raw := strings.TrimSpace(r.URL.Query().Get("timeout_ms")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || time.Duration(value)*time.Millisecond > desktopIPCMaxEventWait {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_timeout", "timeout_ms must be between 1 and 30000")
			return
		}
		wait = time.Duration(value) * time.Millisecond
	}

	ctx, cancel := context.WithTimeout(r.Context(), wait)
	defer cancel()
	snapshot, revision, changed := h.ctrl.WaitSnapshot(ctx, after)
	w.Header().Set("X-XDrive-Revision", strconv.FormatUint(revision, 10))
	if !changed {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, desktopIPCEvent{
		Type:     "status.changed",
		Revision: revision,
		Status:   makeDesktopIPCStatus(snapshot, revision),
	})
}

func (h *desktopIPCHandler) login(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Server    string `json:"server"`
		Username  string `json:"username"`
		Password  string `json:"password"`
		MountPath string `json:"mount_path,omitempty"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if err := h.ctrl.Authenticate(input.Server, input.Username, input.Password, input.MountPath); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) logout(w http.ResponseWriter, _ *http.Request) {
	if err := h.ctrl.Logout(); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) changePassword(w http.ResponseWriter, r *http.Request) {
	var input struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.CurrentPassword) == "" || strings.TrimSpace(input.NewPassword) == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_password", "current_password and new_password are required")
		return
	}
	if err := h.ctrl.ChangePassword(input.CurrentPassword, input.NewPassword); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) pause(w http.ResponseWriter, _ *http.Request) {
	if err := h.ctrl.SetPaused(true); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) resume(w http.ResponseWriter, _ *http.Request) {
	if err := h.ctrl.SetPaused(false); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) syncNow(w http.ResponseWriter, _ *http.Request) {
	if err := h.ctrl.SyncNow(); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) settings(w http.ResponseWriter, _ *http.Request) {
	cfg, root, err := h.ctrl.Settings()
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, desktopIPCSettings{
		MountPath:       root,
		CacheLimitBytes: cfg.CacheLimitBytes,
		SyncRules:       append([]userconfig.SyncRule(nil), cfg.SyncRules...),
	})
}

func (h *desktopIPCHandler) updateSettings(w http.ResponseWriter, r *http.Request) {
	var input struct {
		MountPath       *string `json:"mount_path"`
		CacheLimitBytes *int64  `json:"cache_limit_bytes"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.MountPath == nil && input.CacheLimitBytes == nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "empty_settings", "at least one setting is required")
		return
	}
	if err := h.ctrl.UpdateSettings(input.MountPath, input.CacheLimitBytes); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.settings(w, r)
}

func (h *desktopIPCHandler) setSyncRule(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Path string `json:"path"`
		Mode string `json:"mode"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Path) == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_sync_rule", "path is required")
		return
	}
	if err := h.ctrl.SetSelectiveSyncRule(input.Path, input.Mode); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.settings(w, r)
}

func (h *desktopIPCHandler) storageTree(w http.ResponseWriter, r *http.Request) {
	tree, err := h.ctrl.StorageTree(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, tree)
}

func (h *desktopIPCHandler) cacheStats(w http.ResponseWriter, _ *http.Request) {
	stats, err := h.ctrl.CacheStats()
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, stats)
}

func (h *desktopIPCHandler) releaseCache(w http.ResponseWriter, _ *http.Request) {
	result, err := h.ctrl.ReleaseReclaimableCache()
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudRoot(w http.ResponseWriter, r *http.Request) {
	node, err := h.ctrl.CloudRoot(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, node)
}

func (h *desktopIPCHandler) cloudChildren(w http.ResponseWriter, r *http.Request) {
	parentID, ok := desktopIPCUint64Query(w, r, "parent_id")
	if !ok {
		return
	}
	items, err := h.ctrl.CloudList(r.Context(), parentID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cloudSearch(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) < 2 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_search_query", "q must contain at least 2 characters")
		return
	}
	items, err := h.ctrl.CloudSearch(r.Context(), query)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cloudQuota(w http.ResponseWriter, r *http.Request) {
	quota, err := h.ctrl.CloudQuota(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, quota)
}

func (h *desktopIPCHandler) cloudStorageStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.ctrl.CloudStorageStats(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, stats)
}

func (h *desktopIPCHandler) cloudTrash(w http.ResponseWriter, r *http.Request) {
	items, err := h.ctrl.CloudTrash(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cloudRestoreTrash(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID       uint64 `json:"id"`
		Revision uint64 `json:"revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 || input.Revision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_trash_item", "id and revision are required")
		return
	}
	node, err := h.ctrl.CloudRestoreTrash(r.Context(), input.ID, input.Revision)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, node)
}

func (h *desktopIPCHandler) cloudDeleteTrash(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID       uint64 `json:"id"`
		Revision uint64 `json:"revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 || input.Revision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_trash_item", "id and revision are required")
		return
	}
	if err := h.ctrl.CloudDeleteTrash(r.Context(), input.ID, input.Revision); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) cloudVersions(w http.ResponseWriter, r *http.Request) {
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	items, err := h.ctrl.CloudVersions(r.Context(), nodeID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cloudRestoreVersion(w http.ResponseWriter, r *http.Request) {
	var input struct {
		NodeID          uint64 `json:"node_id"`
		CurrentRevision uint64 `json:"current_revision"`
		VersionID       uint64 `json:"version_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.NodeID == 0 || input.CurrentRevision == 0 || input.VersionID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_version_restore", "node_id, current_revision, and version_id are required")
		return
	}
	node, err := h.ctrl.CloudRestoreVersion(r.Context(), input.NodeID, input.CurrentRevision, input.VersionID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, node)
}

func (h *desktopIPCHandler) cloudShares(w http.ResponseWriter, r *http.Request) {
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	items, err := h.ctrl.CloudShares(r.Context(), nodeID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) cloudCreateShare(w http.ResponseWriter, r *http.Request) {
	var input struct {
		NodeID       uint64 `json:"node_id"`
		ExpiresAt    string `json:"expires_at,omitempty"`
		Password     string `json:"password,omitempty"`
		MaxDownloads int64  `json:"max_downloads,omitempty"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.NodeID == 0 || input.MaxDownloads < 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_share", "node_id is required and max_downloads must be non-negative")
		return
	}
	var expiresAt *time.Time
	if value := strings.TrimSpace(input.ExpiresAt); value != "" {
		parsed, err := time.Parse(time.RFC3339, value)
		if err != nil || !parsed.After(time.Now()) {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_share_expiry", "expires_at must be a future RFC3339 timestamp")
			return
		}
		expiresAt = &parsed
	}
	created, err := h.ctrl.CloudCreateShare(r.Context(), input.NodeID, client.CreateShareInput{
		ExpiresAt: expiresAt, Password: input.Password, MaxDownloads: input.MaxDownloads,
	})
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, created)
}

func (h *desktopIPCHandler) cloudRevokeShare(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID uint64 `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.ID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_share", "id is required")
		return
	}
	if err := h.ctrl.CloudRevokeShare(r.Context(), input.ID); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func desktopIPCUint64Query(w http.ResponseWriter, r *http.Request, name string) (uint64, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || value == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_"+name, name+" must be a positive integer")
		return 0, false
	}
	return value, true
}

func (h *desktopIPCHandler) sources(w http.ResponseWriter, r *http.Request) {
	items, err := h.ctrl.CloudSources(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) sourceRuns(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "source_id must be a positive integer")
		return
	}
	limit := 1
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 200 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 200")
			return
		}
		limit = value
	}
	items, err := h.ctrl.CloudSourceRuns(r.Context(), sourceID, limit)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) sourceCredentialStatus(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "source_id must be a positive integer")
		return
	}
	status, err := h.ctrl.CloudSourceCredentialStatus(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, status)
}

func (h *desktopIPCHandler) fileAvailability(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if path == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_path", "path is required")
		return
	}
	state, err := h.ctrl.FileAvailability(path)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, state)
}

func (h *desktopIPCHandler) setFileAvailability(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Path   string `json:"path"`
		Action string `json:"action"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Path) == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_path", "path is required")
		return
	}
	switch input.Action {
	case "keep", "release", "online", "sync":
	default:
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_file_action", "action must be keep, release, online, or sync")
		return
	}
	if err := h.ctrl.SetFileAvailability(input.Path, input.Action); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	state, err := h.ctrl.FileAvailability(input.Path)
	if err != nil {
		if input.Action == "sync" {
			writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, state)
}

func (h *desktopIPCHandler) transfers(w http.ResponseWriter, _ *http.Request) {
	revision, items := h.ctrl.Transfers()
	writeDesktopIPCJSON(w, http.StatusOK, desktopIPCTransfers{Revision: revision, Transfers: items})
}

func (h *desktopIPCHandler) transferEvents(w http.ResponseWriter, r *http.Request) {
	after := uint64(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("after_revision")); raw != "" {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_after_revision", "after_revision must be an unsigned integer")
			return
		}
		after = value
	}
	wait := desktopIPCDefaultEventWait
	if raw := strings.TrimSpace(r.URL.Query().Get("timeout_ms")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || time.Duration(value)*time.Millisecond > desktopIPCMaxEventWait {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_timeout", "timeout_ms must be between 1 and 30000")
			return
		}
		wait = time.Duration(value) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(r.Context(), wait)
	defer cancel()
	revision, items, changed := h.ctrl.WaitTransfers(ctx, after)
	w.Header().Set("X-XDrive-Transfer-Revision", strconv.FormatUint(revision, 10))
	if !changed {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, desktopIPCTransferEvent{
		Type:      "transfers.changed",
		Revision:  revision,
		Transfers: items,
	})
}

func (h *desktopIPCHandler) retryTransfer(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID string `json:"id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.ID = strings.TrimSpace(input.ID)
	if input.ID == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "missing_transfer_id", "id is required")
		return
	}
	if err := h.ctrl.RetryTransfer(r.Context(), input.ID); err != nil {
		writeDesktopIPCError(w, http.StatusConflict, "transfer_retry_failed", err.Error())
		return
	}
	revision, items := h.ctrl.Transfers()
	writeDesktopIPCJSON(w, http.StatusOK, desktopIPCTransfers{Revision: revision, Transfers: items})
}

func (h *desktopIPCHandler) diagnostics(w http.ResponseWriter, r *http.Request) {
	report := h.ctrl.Diagnostics(r.Context())
	writeDesktopIPCJSON(w, http.StatusOK, report)
}

func (h *desktopIPCHandler) diagnosticReport(w http.ResponseWriter, r *http.Request) {
	report := h.ctrl.Diagnostics(r.Context())
	writeDesktopIPCJSON(w, http.StatusOK, map[string]string{"report": diagnostics.FormatText(report)})
}

func (h *desktopIPCHandler) reconnect(w http.ResponseWriter, r *http.Request) {
	if err := h.ctrl.Reconnect(r.Context()); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) repairSyncRoot(w http.ResponseWriter, r *http.Request) {
	if err := h.ctrl.RepairSyncRoot(r.Context()); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	h.writeStatus(w)
}

func (h *desktopIPCHandler) openLogs(w http.ResponseWriter, _ *http.Request) {
	if err := h.ctrl.OpenLogs(); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) conflicts(w http.ResponseWriter, _ *http.Request) {
	writeDesktopIPCJSON(w, http.StatusOK, map[string]any{"conflicts": h.ctrl.Conflicts()})
}

func (h *desktopIPCHandler) openConflict(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID   string `json:"id"`
		Both bool   `json:"both,omitempty"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.ID) == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "missing_conflict_id", "id is required")
		return
	}
	if err := h.ctrl.OpenConflict(input.ID, input.Both); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) resolveConflict(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID     string `json:"id"`
		Choice string `json:"choice"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.ID) == "" || (input.Choice != "server" && input.Choice != "local") {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_conflict_resolution", "id and choice=server|local are required")
		return
	}
	if err := h.ctrl.ResolveConflict(input.ID, input.Choice); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) openFolder(w http.ResponseWriter, _ *http.Request) {
	if err := h.ctrl.OpenFolder(); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) writeStatus(w http.ResponseWriter) {
	snapshot, revision := h.ctrl.SnapshotWithRevision()
	writeDesktopIPCJSON(w, http.StatusOK, makeDesktopIPCStatus(snapshot, revision))
}

func makeDesktopIPCStatus(snapshot agentSnapshot, revision uint64) desktopIPCStatus {
	return desktopIPCStatus{
		Revision:           revision,
		Configured:         snapshot.Configured,
		Username:           snapshot.Username,
		Server:             snapshot.Server,
		MountPath:          snapshot.MountPath,
		AuthStatus:         snapshot.AuthStatus,
		SyncStatus:         snapshot.SyncStatus,
		Paused:             snapshot.Paused,
		MustChangePassword: snapshot.MustChangePassword,
		LastError:          snapshot.LastError,
		HasConflict:        snapshot.HasConflict,
		ConflictCount:      snapshot.ConflictCount,
		Version:            snapshot.Version,
	}
}

func decodeDesktopIPCJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, desktopIPCMaxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_json", "request body must contain one JSON object")
		return false
	}
	return true
}

func writeDesktopIPCControllerError(w http.ResponseWriter, err error) {
	var apiErr *client.APIError
	if errors.As(err, &apiErr) {
		status := apiErr.Status
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		code := strings.TrimSpace(apiErr.Msg)
		if code == "" {
			code = "server_error"
		}
		writeDesktopIPCError(w, status, code, err.Error())
		return
	}
	writeDesktopIPCError(w, http.StatusBadRequest, "operation_failed", err.Error())
}

func writeDesktopIPCError(w http.ResponseWriter, status int, code, message string) {
	writeDesktopIPCJSON(w, status, map[string]string{
		"error":   code,
		"message": message,
	})
}

func writeDesktopIPCJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("desktop IPC response encode failed: %v", err)
	}
}
