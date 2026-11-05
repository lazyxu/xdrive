package api

import (
	"crypto/rand"
	"encoding/hex"
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

const serverUpdateRunnerFreshness = 45 * time.Second

var offlineImportID = regexp.MustCompile(`^[a-f0-9]{32}$`)
var offlineDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)

type serverUpdateState struct {
	Supported         bool   `json:"supported"`
	State             string `json:"state"`
	Source            string `json:"source"`
	Channel           string `json:"channel"`
	BackupFileData    bool   `json:"backup_file_data"`
	RequestID         string `json:"request_id,omitempty"`
	Stage             string `json:"stage,omitempty"`
	StageCurrent      int    `json:"stage_current,omitempty"`
	StageTotal        int    `json:"stage_total,omitempty"`
	BytesDone         int64  `json:"bytes_done,omitempty"`
	BytesTotal        int64  `json:"bytes_total,omitempty"`
	Message           string `json:"message,omitempty"`
	Error             string `json:"error,omitempty"`
	StartedAt         string `json:"started_at,omitempty"`
	UpdatedAt         string `json:"updated_at,omitempty"`
	FinishedAt        string `json:"finished_at,omitempty"`
	RunnerHeartbeatAt string `json:"runner_heartbeat_at,omitempty"`
}

type serverUpdateRequestFile struct {
	RequestID              string `json:"request_id"`
	Source                 string `json:"source"`
	Channel                string `json:"channel"`
	BackupFileData         bool   `json:"backup_file_data"`
	OfflineID              string `json:"offline_id,omitempty"`
	OfflineTrustMode       string `json:"offline_trust_mode,omitempty"`
	TrustedManifestSHA256  string `json:"trusted_manifest_sha256,omitempty"`
	TrustedInstallerSHA256 string `json:"trusted_installer_sha256,omitempty"`
	RequestedBy            string `json:"requested_by,omitempty"`
	CreatedAt              string `json:"created_at"`
}

func (s *Server) adminServerUpdateStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, s.serverUpdateStatus())
}

func (s *Server) adminStartServerUpdate(c *gin.Context) {
	var input struct {
		Source                 string `json:"source"`
		Channel                string `json:"channel"`
		BackupFileData         bool   `json:"backup_file_data"`
		OfflineID              string `json:"offline_id"`
		OfflineTrustMode       string `json:"offline_trust_mode"`
		TrustedManifestSHA256  string `json:"trusted_manifest_sha256"`
		TrustedInstallerSHA256 string `json:"trusted_installer_sha256"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_json"})
		return
	}
	input.Source = strings.ToLower(strings.TrimSpace(input.Source))
	input.Channel = strings.ToLower(strings.TrimSpace(input.Channel))
	if input.Source != "github" && input.Source != "gitlab" && input.Source != "xdrive" && input.Source != "offline" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_update_source", "detail": "source must be github, gitlab, xdrive or offline"})
		return
	}
	if input.Channel != "stable" && input.Channel != "master" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_update_channel", "detail": "channel must be stable or master"})
		return
	}
	if input.Source == "offline" {
		if input.Channel != "master" || !offlineImportID.MatchString(input.OfflineID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_offline_import"})
			return
		}
		// Explicit signed mode does not accept browser-supplied digests. The
		// isolated Host independently checks a Host-owned Sigstore root and
		// verified bundle. Empty/sha256 modes preserve existing CLI clients.
		if input.OfflineTrustMode == "sigstore" {
			if input.TrustedManifestSHA256 != "" || input.TrustedInstallerSHA256 != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_offline_trust"})
				return
			}
		} else if (input.OfflineTrustMode != "" && input.OfflineTrustMode != "sha256") ||
			!offlineDigest.MatchString(input.TrustedManifestSHA256) ||
			!offlineDigest.MatchString(input.TrustedInstallerSHA256) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_offline_trust"})
			return
		}
	} else if input.OfflineID != "" || input.OfflineTrustMode != "" || input.TrustedManifestSHA256 != "" ||
		input.TrustedInstallerSHA256 != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "offline_update_options_forbidden"})
		return
	}
	if input.Source == "xdrive" && input.Channel != "master" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_update_channel", "detail": "xdrive source requires the master channel"})
		return
	}

	// Serialize online/offline update admission with read-only offline preflight.
	s.offlineUpdateImportMu.Lock()
	defer s.offlineUpdateImportMu.Unlock()
	if s.offlineHostPlanBusy() {
		c.JSON(http.StatusConflict, gin.H{"error": "offline_host_preflight_in_progress"})
		return
	}

	state := s.serverUpdateStatus()
	if !state.Supported {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":  "server_update_unavailable",
			"detail": state.Message,
		})
		return
	}
	if state.State == "queued" || state.State == "running" {
		c.JSON(http.StatusConflict, gin.H{"error": "server_update_in_progress"})
		return
	}

	requestID, err := randomServerUpdateRequestID()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_update_request_failed"})
		return
	}
	requestedBy := ""
	if user, ok := currentUser(c); ok {
		requestedBy = user.Username
	}
	request := serverUpdateRequestFile{
		RequestID:              requestID,
		Source:                 input.Source,
		Channel:                input.Channel,
		BackupFileData:         input.BackupFileData,
		OfflineID:              input.OfflineID,
		OfflineTrustMode:       input.OfflineTrustMode,
		TrustedManifestSHA256:  input.TrustedManifestSHA256,
		TrustedInstallerSHA256: input.TrustedInstallerSHA256,
		RequestedBy:            requestedBy,
		CreatedAt:              time.Now().UTC().Format(time.RFC3339),
	}
	if err := s.writeServerUpdateRequest(request); err != nil {
		if errors.Is(err, os.ErrExist) {
			c.JSON(http.StatusConflict, gin.H{"error": "server_update_in_progress"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_update_request_failed"})
		return
	}

	c.JSON(http.StatusAccepted, serverUpdateState{
		Supported:      true,
		State:          "queued",
		Source:         request.Source,
		Channel:        request.Channel,
		BackupFileData: request.BackupFileData,
		RequestID:      request.RequestID,
		Message:        "更新请求已提交，等待服务器宿主机执行。",
		UpdatedAt:      request.CreatedAt,
	})
}

func (s *Server) serverUpdateStatus() serverUpdateState {
	dir := strings.TrimSpace(s.HostControlDir)
	if dir == "" {
		return unavailableServerUpdateState("当前服务端未配置宿主机更新控制。")
	}

	statusPath := filepath.Join(dir, "status.json")
	raw, err := os.ReadFile(statusPath)
	if err != nil {
		if os.IsNotExist(err) {
			return unavailableServerUpdateState("宿主机更新控制尚未启动。")
		}
		return unavailableServerUpdateState("无法读取宿主机更新状态。")
	}

	var state serverUpdateState
	if err := json.Unmarshal(raw, &state); err != nil {
		return unavailableServerUpdateState("宿主机更新状态格式无效。")
	}
	if state.Source != "github" && state.Source != "gitlab" && state.Source != "xdrive" && state.Source != "offline" {
		state.Source = "github"
	}
	if state.Channel != "stable" && state.Channel != "master" {
		state.Channel = "stable"
	}

	heartbeatPath := filepath.Join(dir, "heartbeat")
	heartbeatInfo, heartbeatErr := os.Stat(heartbeatPath)
	if heartbeatErr != nil || time.Since(heartbeatInfo.ModTime()) > serverUpdateRunnerFreshness {
		stale := unavailableServerUpdateState("宿主机更新控制没有活动心跳，请检查 xdrive-server control。")
		stale.Source = state.Source
		stale.Channel = state.Channel
		stale.BackupFileData = state.BackupFileData
		stale.UpdatedAt = state.UpdatedAt
		stale.RunnerHeartbeatAt = state.RunnerHeartbeatAt
		return stale
	}
	state.RunnerHeartbeatAt = heartbeatInfo.ModTime().UTC().Format(time.RFC3339)
	state.Supported = true
	if state.State == "" || state.State == "unavailable" {
		state.State = "idle"
	}

	requestPath := filepath.Join(dir, "request.json")
	if state.State != "running" {
		if requestRaw, readErr := os.ReadFile(requestPath); readErr == nil {
			var request serverUpdateRequestFile
			if json.Unmarshal(requestRaw, &request) == nil &&
				(request.Source == "github" || request.Source == "gitlab" || request.Source == "xdrive" || request.Source == "offline") &&
				(request.Source != "xdrive" || request.Channel == "master") &&
				(request.Source != "offline" || (request.Channel == "master" &&
					offlineImportID.MatchString(request.OfflineID) &&
					((request.OfflineTrustMode == "sigstore" &&
						request.TrustedManifestSHA256 == "" && request.TrustedInstallerSHA256 == "") ||
						((request.OfflineTrustMode == "" || request.OfflineTrustMode == "sha256") &&
							offlineDigest.MatchString(request.TrustedManifestSHA256) &&
							offlineDigest.MatchString(request.TrustedInstallerSHA256))))) &&
				(request.Channel == "stable" || request.Channel == "master") {
				state.State = "queued"
				state.Source = request.Source
				state.Channel = request.Channel
				state.BackupFileData = request.BackupFileData
				state.RequestID = request.RequestID
				state.Message = "更新请求已提交，等待服务器宿主机执行。"
				state.UpdatedAt = request.CreatedAt
			}
		}
	}
	return state
}

func unavailableServerUpdateState(message string) serverUpdateState {
	return serverUpdateState{
		Supported: false,
		State:     "unavailable",
		Source:    "github",
		Channel:   "stable",
		Message:   message,
	}
}

func (s *Server) writeServerUpdateRequest(request serverUpdateRequestFile) error {
	dir := strings.TrimSpace(s.HostControlDir)
	if dir == "" {
		return errors.New("host control directory is not configured")
	}
	raw, err := json.Marshal(request)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".request-*.tmp")
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
	requestPath := filepath.Join(dir, "request.json")
	if err := os.Link(tmpPath, requestPath); err != nil {
		return err
	}
	return nil
}

func randomServerUpdateRequestID() (string, error) {
	var value [12]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}
