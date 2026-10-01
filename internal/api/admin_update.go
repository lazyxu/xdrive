package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const serverUpdateRunnerFreshness = 45 * time.Second

type serverUpdateState struct {
	Supported         bool   `json:"supported"`
	State             string `json:"state"`
	Source            string `json:"source"`
	Channel           string `json:"channel"`
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
	RequestID   string `json:"request_id"`
	Source      string `json:"source"`
	Channel     string `json:"channel"`
	RequestedBy string `json:"requested_by,omitempty"`
	CreatedAt   string `json:"created_at"`
}

func (s *Server) adminServerUpdateStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, s.serverUpdateStatus())
}

func (s *Server) adminStartServerUpdate(c *gin.Context) {
	var input struct {
		Source  string `json:"source"`
		Channel string `json:"channel"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_json"})
		return
	}
	input.Source = strings.ToLower(strings.TrimSpace(input.Source))
	input.Channel = strings.ToLower(strings.TrimSpace(input.Channel))
	if input.Source != "github" && input.Source != "gitlab" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_update_source", "detail": "source must be github or gitlab"})
		return
	}
	if input.Channel != "stable" && input.Channel != "master" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_update_channel", "detail": "channel must be stable or master"})
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
		RequestID:   requestID,
		Source:      input.Source,
		Channel:     input.Channel,
		RequestedBy: requestedBy,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
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
		Supported: true,
		State:     "queued",
		Source:    request.Source,
		Channel:   request.Channel,
		RequestID: request.RequestID,
		Message:   "更新请求已提交，等待服务器宿主机执行。",
		UpdatedAt: request.CreatedAt,
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
	if state.Source != "github" && state.Source != "gitlab" {
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
				(request.Source == "github" || request.Source == "gitlab") &&
				(request.Channel == "stable" || request.Channel == "master") {
				state.State = "queued"
				state.Source = request.Source
				state.Channel = request.Channel
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
