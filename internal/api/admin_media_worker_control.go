package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/mediaworker"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	mediaWorkerControlStatusName  = "media-worker-control-status.json"
	mediaWorkerControlRequestName = "media-worker-control-request.json"
	mediaWorkerHostFreshness      = 45 * time.Second
	mediaWorkerControlSocket      = "/run/xdrive-media-worker/media-worker.sock"
)

var mediaWorkerRequestIDPattern = regexp.MustCompile(`^[a-f0-9]{24}$`)

type mediaWorkerHostStatus struct {
	Supported            bool   `json:"supported"`
	State                string `json:"state"`
	Revision             uint64 `json:"revision"`
	AppliedRevision      uint64 `json:"applied_revision"`
	Enabled              bool   `json:"enabled"`
	ObservedEnabled      bool   `json:"observed_enabled"`
	MemoryMiB            int    `json:"memory_mib"`
	ObservedMemoryMiB    int    `json:"observed_memory_mib"`
	MemoryVerified       bool   `json:"memory_verified"`
	CPUMilli             int    `json:"cpu_milli"`
	ObservedCPUMilli     int    `json:"observed_cpu_milli"`
	CPUVerified          bool   `json:"cpu_verified"`
	CPUControlSupported  bool   `json:"cpu_control_supported"`
	PIDsLimit            int    `json:"pids_limit"`
	ObservedPIDsLimit    int    `json:"observed_pids_limit"`
	PIDsVerified         bool   `json:"pids_verified"`
	PIDsControlSupported bool   `json:"pids_control_supported"`
	RequestID            string `json:"request_id,omitempty"`
	UpdatedAt            string `json:"updated_at,omitempty"`
}

type mediaWorkerHostRequest struct {
	RequestID string `json:"request_id"`
	Revision  uint64 `json:"revision"`
	Enabled   bool   `json:"enabled"`
	MemoryMiB int    `json:"memory_mib"`
	CPUMilli  int    `json:"cpu_milli"`
	PIDsLimit int    `json:"pids_limit"`
	CreatedAt string `json:"created_at"`
}

// Existing queued/active work must remain fenced even if the runner heartbeat
// dies; a new desired save must not allow stale host work to execute on restart.
func (s *Server) mediaWorkerHostBusy() bool {
	if s == nil || strings.TrimSpace(s.HostControlDir) == "" {
		return false
	}
	for _, file := range []string{mediaWorkerControlRequestName, "media-worker-control-active.json"} {
		_, err := os.Lstat(filepath.Join(s.HostControlDir, file))
		if err == nil || !errors.Is(err, os.ErrNotExist) {
			return true
		}
	}
	return false
}

func unavailableMediaWorkerHost() mediaWorkerHostStatus {
	return mediaWorkerHostStatus{State: "unavailable"}
}

func validMediaWorkerHostState(state string) bool {
	switch state {
	case "idle", "queued", "running", "success", "failed":
		return true
	default:
		return false
	}
}

// The host bridge reports only a bounded/validated summary. Never pass a host
// path, raw runner error or process/container ID into the admin response.
func (s *Server) readMediaWorkerHostStatus() mediaWorkerHostStatus {
	host := unavailableMediaWorkerHost()
	if s == nil || strings.TrimSpace(s.HostControlDir) == "" {
		return host
	}
	info, err := os.Stat(filepath.Join(s.HostControlDir, "heartbeat"))
	if err != nil || time.Since(info.ModTime()) > mediaWorkerHostFreshness ||
		time.Until(info.ModTime()) > 15*time.Second {
		return host
	}
	content, err := os.ReadFile(filepath.Join(s.HostControlDir, mediaWorkerControlStatusName))
	if err != nil || len(content) > 4096 {
		return host
	}
	if json.Unmarshal(content, &host) != nil || !validMediaWorkerHostState(host.State) ||
		(host.RequestID != "" && !mediaWorkerRequestIDPattern.MatchString(host.RequestID)) ||
		host.AppliedRevision > host.Revision || host.Revision > (1<<60) ||
		(host.MemoryMiB != 0 && !mediaworker.ValidMemoryMiB(host.MemoryMiB)) ||
		(host.ObservedMemoryMiB != 0 && !mediaworker.ValidMemoryMiB(host.ObservedMemoryMiB)) ||
		(host.MemoryVerified && !mediaworker.ValidMemoryMiB(host.ObservedMemoryMiB)) ||
		(host.CPUMilli != 0 && !mediaworker.ValidCPUMilli(host.CPUMilli)) ||
		(host.ObservedCPUMilli != 0 && !mediaworker.ValidCPUMilli(host.ObservedCPUMilli)) ||
		(host.CPUVerified && (!host.CPUControlSupported || !mediaworker.ValidCPUMilli(host.ObservedCPUMilli))) ||
		(host.CPUControlSupported && host.Revision > 0 && !mediaworker.ValidCPUMilli(host.CPUMilli)) ||
		(host.PIDsLimit != 0 && !mediaworker.ValidPIDsLimit(host.PIDsLimit)) ||
		(host.ObservedPIDsLimit != 0 && !mediaworker.ValidPIDsLimit(host.ObservedPIDsLimit)) ||
		(host.PIDsVerified && (!host.PIDsControlSupported || !mediaworker.ValidPIDsLimit(host.ObservedPIDsLimit))) ||
		(host.PIDsControlSupported && host.Revision > 0 && !mediaworker.ValidPIDsLimit(host.PIDsLimit)) {
		return unavailableMediaWorkerHost()
	}
	host.Supported = true
	// The runner may not yet have moved the latest request into active state.
	raw, err := os.ReadFile(filepath.Join(s.HostControlDir, mediaWorkerControlRequestName))
	if err == nil && len(raw) <= 1024 {
		var queued mediaWorkerHostRequest
		if json.Unmarshal(raw, &queued) == nil && queued.Revision > 0 &&
			mediaWorkerRequestIDPattern.MatchString(queued.RequestID) &&
			mediaworker.ValidMemoryMiB(queued.MemoryMiB) &&
			mediaworker.ValidCPUMilli(queued.CPUMilli) &&
			mediaworker.ValidPIDsLimit(queued.PIDsLimit) {
			host.State = "queued"
			host.RequestID = queued.RequestID
			host.Revision = queued.Revision
			host.Enabled = queued.Enabled
			host.MemoryMiB = queued.MemoryMiB
			host.CPUMilli = queued.CPUMilli
			host.PIDsLimit = queued.PIDsLimit
			host.PIDsVerified = false
			host.MemoryVerified = false
			host.CPUVerified = false
		}
	}
	return host
}

type adminMediaWorkerConfigDTO struct {
	DesiredEnabled   bool                  `json:"desired_enabled"`
	DesiredMemoryMiB int                   `json:"desired_memory_mib"`
	DesiredCPUMilli  int                   `json:"desired_cpu_milli"`
	DesiredPIDsLimit int                   `json:"desired_pids_limit"`
	Revision         uint64                `json:"revision"`
	Source           string                `json:"source"`
	UpdatedAt        *time.Time            `json:"updated_at,omitempty"`
	ApplyState       string                `json:"apply_state"`
	Host             mediaWorkerHostStatus `json:"host"`
	RuntimeReady     bool                  `json:"runtime_ready"`
	Editable         bool                  `json:"editable"`
	ApplySupported   bool                  `json:"apply_supported"`
	RequiresRestart  bool                  `json:"requires_restart"`
}

func (s *Server) mediaWorkerRuntimeReady(ctx context.Context) bool {
	var prober mediaworker.Prober
	if s != nil {
		prober = s.MediaWorkerProbe
	}
	// For an online activation the pre-existing Server need not be restarted
	// just to set its optional socket env. The host only mounts this fixed
	// private path in the trusted Compose manifest.
	if prober == nil && s != nil && s.HostControlDir != "" {
		client, err := mediaworker.NewUnixClient(mediaWorkerControlSocket, 1200*time.Millisecond)
		if err == nil {
			prober = client
		}
	}
	if prober == nil {
		return false
	}
	probeCtx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	info, err := prober.Info(probeCtx)
	return err == nil && mediaworker.ValidInfo(info)
}

// mediaWorkerApplied is the single source of truth for Media Worker desired/
// actual resource and health acknowledgement across the admin detail and overview.
// A healthy executable by itself does not prove resource limits were applied.
func mediaWorkerApplied(desired mediaWorkerDesired, host mediaWorkerHostStatus, runtimeReady bool) bool {
	return desired.Revision > 0 && host.Supported && host.State == "success" &&
		host.Revision == desired.Revision && host.AppliedRevision == desired.Revision &&
		host.Enabled == desired.Enabled && host.ObservedEnabled == desired.Enabled &&
		host.MemoryMiB == desired.MemoryMiB && host.MemoryVerified &&
		host.ObservedMemoryMiB == desired.MemoryMiB &&
		host.CPUControlSupported && host.CPUMilli == desired.CPUMilli &&
		host.CPUVerified && host.ObservedCPUMilli == desired.CPUMilli &&
		host.PIDsControlSupported && host.PIDsLimit == desired.PIDsLimit &&
		host.PIDsVerified && host.ObservedPIDsLimit == desired.PIDsLimit &&
		(!desired.Enabled || runtimeReady)
}

// Applied means exact desired revision AND observed Host container state AND,
// when enabled, a successful live FFmpeg/FFprobe Unix-socket probe. No success
// is inferred from a saved database row or queued host request.
func (s *Server) adminMediaWorkerConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "media worker settings unavailable")
		return
	}
	desired, err := s.readMediaWorkerDesired(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "media worker settings unreadable")
		return
	}
	host := s.readMediaWorkerHostStatus()
	ready := false
	if host.Supported && host.ObservedEnabled {
		ready = s.mediaWorkerRuntimeReady(c.Request.Context())
	}
	state := "unmanaged"
	if desired.Revision != 0 {
		state = "pending"
		if !host.Supported {
			state = "unavailable"
		}
		if host.State == "failed" && host.Revision == desired.Revision {
			state = "failed"
		}
		if mediaWorkerApplied(desired, host, ready) {
			state = "applied"
		}
	}
	c.JSON(http.StatusOK, adminMediaWorkerConfigDTO{
		DesiredEnabled: desired.Enabled, DesiredMemoryMiB: desired.MemoryMiB, DesiredCPUMilli: desired.CPUMilli, DesiredPIDsLimit: desired.PIDsLimit,
		Revision: desired.Revision, Source: desired.Source,
		UpdatedAt: desired.UpdatedAt, ApplyState: state, Host: host,
		RuntimeReady: ready, Editable: true, ApplySupported: host.Supported && host.CPUControlSupported && host.PIDsControlSupported,
		RequiresRestart: false,
	})
}

func writeMediaWorkerHostRequest(dir string, request mediaWorkerHostRequest) error {
	if dir == "" || request.Revision == 0 || !mediaWorkerRequestIDPattern.MatchString(request.RequestID) ||
		!mediaworker.ValidMemoryMiB(request.MemoryMiB) || !mediaworker.ValidCPUMilli(request.CPUMilli) || !mediaworker.ValidPIDsLimit(request.PIDsLimit) {
		return errors.New("invalid media worker host request")
	}
	data, err := json.Marshal(request)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".media-worker-request-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0660); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	// Atomic no-clobber queue (not rename): only one pending request is allowed.
	return os.Link(tmp.Name(), filepath.Join(dir, mediaWorkerControlRequestName))
}

func (s *Server) adminApplyMediaWorker(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "media worker settings unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		Revision *uint64 `json:"revision"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil || *input.Revision == 0 {
		fail(c, http.StatusBadRequest, "saved media worker revision is required")
		return
	}
	s.mediaWorkerConfigSaveMu.Lock()
	defer s.mediaWorkerConfigSaveMu.Unlock()
	host := s.readMediaWorkerHostStatus()
	if !host.Supported || !host.CPUControlSupported || !host.PIDsControlSupported {
		fail(c, http.StatusServiceUnavailable, "host media worker resource-capable control unavailable")
		return
	}
	if s.mediaWorkerHostBusy() || host.State == "queued" || host.State == "running" {
		fail(c, http.StatusConflict, "media worker operation is already queued/running")
		return
	}
	desired, err := s.readMediaWorkerDesired(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "media worker settings unavailable")
		return
	}
	if desired.Revision != *input.Revision {
		fail(c, http.StatusConflict, "media worker desired revision changed")
		return
	}
	if host.AppliedRevision >= desired.Revision && host.State != "failed" {
		fail(c, http.StatusConflict, "media worker revision was already applied or superseded")
		return
	}
	requestID, err := randomServerUpdateRequestID()
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "media worker request generation failed")
		return
	}
	request := mediaWorkerHostRequest{
		RequestID: requestID, Revision: desired.Revision, Enabled: desired.Enabled, MemoryMiB: desired.MemoryMiB, CPUMilli: desired.CPUMilli, PIDsLimit: desired.PIDsLimit,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	// Authorization is durably audited before any host operation is queued.
	// A later queue failure remains un-applied and can be retried explicitly.
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var revision uint64
		if err := tx.Model(&meta.AdminMediaWorkerSetting{}).
			Where("name = ?", mediaWorkerSettingName).Select("revision").Scan(&revision).Error; err != nil {
			return err
		}
		if revision != request.Revision {
			return errMediaWorkerRevision
		}
		return recordAuditTx(tx, auditEventFromContext(c,
			"admin.service.media-worker.apply.authorize", "service", "media-worker",
			"FFmpeg Media Worker", auditpkg.ResultSuccess,
			map[string]any{"revision": request.Revision, "enabled": request.Enabled,
				"memory_mib": request.MemoryMiB, "cpu_milli": request.CPUMilli, "pids_limit": request.PIDsLimit, "request_id": request.RequestID},
		))
	})
	if errors.Is(err, errMediaWorkerRevision) {
		fail(c, http.StatusConflict, "media worker revision changed")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "media worker apply not audited")
		return
	}
	err = writeMediaWorkerHostRequest(s.HostControlDir, request)
	if errors.Is(err, os.ErrExist) {
		fail(c, http.StatusConflict, "media worker apply request already queued")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "host media worker request not queued")
		return
	}
	c.JSON(http.StatusAccepted, gin.H{
		"state": "queued", "revision": request.Revision,
		"enabled": request.Enabled, "memory_mib": request.MemoryMiB, "cpu_milli": request.CPUMilli, "pids_limit": request.PIDsLimit, "request_id": request.RequestID,
	})
}
