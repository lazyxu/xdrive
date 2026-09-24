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
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/conflictstate"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

const (
	desktopIPCAPIVersion       = 1
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

func startDesktopIPC(ctx context.Context, ctrl desktopIPCController) (*desktopIPCServer, error) {
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
			Handler:           newDesktopIPCHandler(ctrl, token),
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

func newDesktopIPCHandler(ctrl desktopIPCController, token string) http.Handler {
	h := &desktopIPCHandler{ctrl: ctrl}
	mux := http.NewServeMux()
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
	mux.HandleFunc("GET /v1/conflicts", h.conflicts)
	mux.HandleFunc("POST /v1/conflicts/open", h.openConflict)
	mux.HandleFunc("POST /v1/conflicts/resolve", h.resolveConflict)
	mux.HandleFunc("POST /v1/open-folder", h.openFolder)
	return desktopIPCAuth(token, mux)
}

type desktopIPCHandler struct {
	ctrl desktopIPCController
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
