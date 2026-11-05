package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

var offlineHostPlanRequestID = regexp.MustCompile(`^[a-f0-9]{24}$`)

type offlineHostPlanRequestFile struct {
	RequestID              string `json:"request_id"`
	OfflineID              string `json:"offline_id"`
	TrustMode              string `json:"offline_trust_mode"`
	TrustedManifestSHA256  string `json:"trusted_manifest_sha256,omitempty"`
	TrustedInstallerSHA256 string `json:"trusted_installer_sha256,omitempty"`
	RequestedBy            string `json:"requested_by,omitempty"`
	CreatedAt              string `json:"created_at"`
}

type offlineHostPlanStatus struct {
	Supported   bool            `json:"supported"`
	State       string          `json:"state"`
	RequestID   string          `json:"request_id,omitempty"`
	OfflineID   string          `json:"offline_id,omitempty"`
	TrustMode   string          `json:"offline_trust_mode,omitempty"`
	Message     string          `json:"message,omitempty"`
	Error       string          `json:"error,omitempty"`
	StartedAt   string          `json:"started_at,omitempty"`
	UpdatedAt   string          `json:"updated_at,omitempty"`
	FinishedAt  string          `json:"finished_at,omitempty"`
	Plan        json.RawMessage `json:"plan,omitempty"`
}

func (s *Server) offlineHostPlanBusy() bool {
	dir := strings.TrimSpace(s.HostControlDir)
	if dir == "" {
		return false
	}
	for _, name := range []string{"plan-request.json", "plan-active.json"} {
		_, err := os.Lstat(filepath.Join(dir, name))
		if err == nil || !errors.Is(err, os.ErrNotExist) {
			return true
		}
	}
	raw, err := readOfflineHostPlanFile(filepath.Join(dir, "plan-status.json"), 64<<10)
	if errors.Is(err, os.ErrNotExist) {
		return false
	}
	if err != nil {
		return true
	}
	var status offlineHostPlanStatus
	if json.Unmarshal(raw, &status) != nil {
		return true
	}
	switch status.State {
	case "idle", "success", "failed":
		return false
	case "queued", "running":
		return true
	default:
		return true
	}
}

func readOfflineHostPlanFile(path string, maxBytes int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
		info.Size() < 0 || info.Size() > maxBytes {
		return nil, errors.New("unsafe offline Host plan file")
	}
	return os.ReadFile(path)
}

func (s *Server) writeOfflineHostPlanStatus(status offlineHostPlanStatus) error {
	dir := strings.TrimSpace(s.HostControlDir)
	if dir == "" {
		return errors.New("Host control directory is not configured")
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("Host control directory is unsafe")
	}
	status.Supported = true
	status.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	raw, err := json.Marshal(status)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".plan-status-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o660); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(append(raw, '\n')); err != nil {
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
	return os.Rename(tmpPath, filepath.Join(dir, "plan-status.json"))
}

func (s *Server) writeOfflineHostPlanRequest(request offlineHostPlanRequestFile) error {
	dir := strings.TrimSpace(s.HostControlDir)
	if dir == "" {
		return errors.New("Host control directory is not configured")
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("Host control directory is unsafe")
	}
	raw, err := json.Marshal(request)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".plan-request-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o660); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(append(raw, '\n')); err != nil {
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
	return os.Link(tmpPath, filepath.Join(dir, "plan-request.json"))
}

func (s *Server) adminStartOfflineHostPlan(c *gin.Context) {
	var input struct {
		OfflineID              string `json:"offline_id"`
		TrustMode              string `json:"offline_trust_mode"`
		TrustedManifestSHA256  string `json:"trusted_manifest_sha256"`
		TrustedInstallerSHA256 string `json:"trusted_installer_sha256"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_json"})
		return
	}
	input.OfflineID = strings.ToLower(strings.TrimSpace(input.OfflineID))
	input.TrustMode = strings.ToLower(strings.TrimSpace(input.TrustMode))
	input.TrustedManifestSHA256 = strings.ToLower(strings.TrimSpace(input.TrustedManifestSHA256))
	input.TrustedInstallerSHA256 = strings.ToLower(strings.TrimSpace(input.TrustedInstallerSHA256))
	if !offlineImportID.MatchString(input.OfflineID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_offline_import"})
		return
	}
	switch input.TrustMode {
	case "sigstore":
		if input.TrustedManifestSHA256 != "" || input.TrustedInstallerSHA256 != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_offline_trust"})
			return
		}
	case "sha256":
		if !offlineDigest.MatchString(input.TrustedManifestSHA256) ||
			!offlineDigest.MatchString(input.TrustedInstallerSHA256) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_offline_trust"})
			return
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_offline_trust"})
		return
	}

	// Serialize plan admission with uploads, cleanup and installation. The
	// Host request contains only fixed IDs and digests; never a path or command.
	s.offlineUpdateImportMu.Lock()
	defer s.offlineUpdateImportMu.Unlock()
	if offlineImportBusy(s) {
		c.JSON(http.StatusConflict, gin.H{"error": "update_or_preflight_in_progress"})
		return
	}
	update := s.serverUpdateStatus()
	if !update.Supported {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "server_update_unavailable", "detail": update.Message,
		})
		return
	}

	root, err := s.offlineUpdateImportRoot()
	if err != nil {
		offlineImportError(c, err)
		return
	}
	session, err := openOfflineImport(root, input.OfflineID)
	if err != nil {
		_ = root.Close()
		offlineImportError(c, err)
		return
	}
	importStatus, statusErr := offlineImportStatusFor(session, input.OfflineID)
	_ = session.Close()
	_ = root.Close()
	if statusErr != nil {
		offlineImportError(c, statusErr)
		return
	}
	if !importStatus.ReadyToVerify {
		c.JSON(http.StatusConflict, gin.H{"error": "offline_import_not_ready"})
		return
	}

	requestID, err := randomServerUpdateRequestID()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "offline_host_plan_request_failed"})
		return
	}
	requestedBy := ""
	if user, ok := currentUser(c); ok {
		requestedBy = user.Username
	}
	createdAt := time.Now().UTC().Format(time.RFC3339)
	request := offlineHostPlanRequestFile{
		RequestID: requestID, OfflineID: input.OfflineID, TrustMode: input.TrustMode,
		TrustedManifestSHA256: input.TrustedManifestSHA256,
		TrustedInstallerSHA256: input.TrustedInstallerSHA256,
		RequestedBy: requestedBy, CreatedAt: createdAt,
	}
	// Publish queued status before the request becomes visible to the Host
	// runner, so a fast runner cannot be overwritten by a late queued write.
	_ = os.Remove(filepath.Join(strings.TrimSpace(s.HostControlDir), "plan-result.json"))
	queued := offlineHostPlanStatus{
		Supported: true, State: "queued", RequestID: requestID,
		OfflineID: input.OfflineID, TrustMode: input.TrustMode,
		Message: "只读宿主机预检已排队；不会启动维护或安装。",
		UpdatedAt: createdAt,
	}
	if err := s.writeOfflineHostPlanStatus(queued); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "offline_host_plan_unavailable"})
		return
	}
	if err := s.writeOfflineHostPlanRequest(request); err != nil {
		queued.State = "failed"
		queued.Error = "Host preflight request could not be queued."
		queued.FinishedAt = time.Now().UTC().Format(time.RFC3339)
		_ = s.writeOfflineHostPlanStatus(queued)
		if errors.Is(err, os.ErrExist) {
			c.JSON(http.StatusConflict, gin.H{"error": "update_or_preflight_in_progress"})
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "offline_host_plan_unavailable"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusAccepted, queued)
}

func (s *Server) adminOfflineHostPlanStatus(c *gin.Context) {
	id := strings.ToLower(strings.TrimSpace(c.Param("id")))
	if !offlineImportID.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_offline_import"})
		return
	}
	c.Header("Cache-Control", "no-store")
	if !s.serverUpdateStatus().Supported {
		c.JSON(http.StatusOK, offlineHostPlanStatus{
			Supported: false, State: "unavailable",
			OfflineID: id, Message: "宿主机更新控制没有活动心跳。",
		})
		return
	}
	dir := strings.TrimSpace(s.HostControlDir)
	if dir == "" {
		c.JSON(http.StatusOK, offlineHostPlanStatus{
			Supported: false, State: "unavailable", OfflineID: id,
			Message: "当前服务端未配置宿主机更新控制。",
		})
		return
	}
	raw, err := readOfflineHostPlanFile(filepath.Join(dir, "plan-status.json"), 64<<10)
	if errors.Is(err, os.ErrNotExist) {
		c.JSON(http.StatusOK, offlineHostPlanStatus{
			Supported: true, State: "idle", OfflineID: id,
			Message: "尚未运行该导入目录的宿主机预检。",
		})
		return
	}
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "offline_host_plan_unavailable"})
		return
	}
	var status offlineHostPlanStatus
	if err := json.Unmarshal(raw, &status); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "offline_host_plan_unavailable"})
		return
	}
	if (status.State != "idle" && status.State != "queued" && status.State != "running" &&
		status.State != "success" && status.State != "failed") {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "offline_host_plan_unavailable"})
		return
	}
	if (status.RequestID != "" && !offlineHostPlanRequestID.MatchString(status.RequestID)) ||
		(status.OfflineID != "" && !offlineImportID.MatchString(status.OfflineID)) ||
		(status.TrustMode != "" && status.TrustMode != "sigstore" && status.TrustMode != "sha256") {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "offline_host_plan_unavailable"})
		return
	}
	if status.OfflineID != id {
		c.JSON(http.StatusOK, offlineHostPlanStatus{
			Supported: true, State: "idle", OfflineID: id,
			Message: "尚未运行该导入目录的宿主机预检。",
		})
		return
	}
	if status.State == "success" {
		plan, err := readOfflineHostPlanFile(filepath.Join(dir, "plan-result.json"), 256<<10)
		if err != nil || !json.Valid(plan) {
			status.State = "failed"
			status.Error = "Host preflight result is missing or invalid."
			status.Plan = nil
		} else {
			var evidence struct {
				ReadOnly  bool `json:"read_only"`
				HostProbe *struct {
					ReadOnly bool `json:"read_only"`
				} `json:"host_probe"`
			}
			if json.Unmarshal(plan, &evidence) != nil || !evidence.ReadOnly ||
				evidence.HostProbe == nil || !evidence.HostProbe.ReadOnly {
				status.State = "failed"
				status.Error = "Host preflight result is not a read-only probe."
			} else {
				status.Plan = json.RawMessage(plan)
			}
		}
	}
	c.JSON(http.StatusOK, status)
}
