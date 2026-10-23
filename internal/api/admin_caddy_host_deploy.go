package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type caddyEnvDeployStatus struct {
	Protocol   string `json:"protocol"`
	RequestID  string `json:"request_id"`
	State      string `json:"state"`
	SHA256     string `json:"sha256"`
	RolledBack bool   `json:"rolled_back,omitempty"`
	Error      string `json:"error,omitempty"`
}

// These are fixed Host Control protocol error codes, never raw Docker, env,
// TLS, provider or process diagnostics. Unknown fields must remain private.
func safeCaddyEnvDeployError(code string) string {
	switch code {
	case "installer-busy", "deploy-refused", "interrupted-deploy", "caddy-deploy-or-verify-failed":
		return code
	default:
		return ""
	}
}

const caddyDeployArchiveTTL = 7 * 24 * time.Hour

func (s *Server) readCaddyEnvDeployStatus(id string) (caddyEnvDeployStatus, error) {
	var status caddyEnvDeployStatus
	if len(id) != 24 || strings.Trim(id, "0123456789abcdef") != "" || s.HostControlDir == "" {
		return status, errCaddyHostEnvConflict
	}
	// Immutable Host-side terminal records survive a newer Save/Deploy or
	// Host Control restart. Never infer live gateway state from history.
	path := filepath.Join(s.HostControlDir, caddyHostEnvResultName)
	archived := false
	folder := filepath.Join(s.HostControlDir, "caddy-deploy-results")
	if d, err := os.Lstat(folder); err == nil {
		if !d.IsDir() || d.Mode().Perm()&0o027 != 0 {
			return status, errCaddyHostEnvUnavailable
		}
		candidate := filepath.Join(folder, id+".json")
		if _, err := os.Lstat(candidate); err == nil {
			path, archived = candidate, true
		} else if !os.IsNotExist(err) {
			return status, errCaddyHostEnvUnavailable
		}
	} else if !os.IsNotExist(err) {
		return status, errCaddyHostEnvUnavailable
	}
	maxAge := 15 * time.Second
	if archived {
		maxAge = caddyDeployArchiveTTL
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 ||
		info.Size() > 1024 || time.Until(info.ModTime()) > 15*time.Second ||
		time.Since(info.ModTime()) > maxAge {
		return status, errCaddyHostEnvUnavailable
	}
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) == 0 || len(raw) > 1024 {
		return status, errCaddyHostEnvUnavailable
	}
	if json.Unmarshal(raw, &status) != nil || status.RequestID != id ||
		status.Protocol != caddyHostEnvProtocol || !validCaddyHostEnvSHA(status.SHA256) {
		return status, errCaddyHostEnvUnavailable
	}
	if status.State != "deploying" && status.State != "deployed" && status.State != "failed" ||
		(archived && status.State == "deploying") {
		return status, errCaddyHostEnvUnavailable
	}
	if status.State == "failed" {
		status.Error = safeCaddyEnvDeployError(status.Error)
	} else {
		// A nonterminal result cannot claim a rollback or carry diagnostics.
		status.Error = ""
		status.RolledBack = false
	}
	return status, nil
}

// Browser/UI is authorized to REQUEST the fixed Caddy-only action, never to
// supply Docker arguments, .env path, container name or provider credentials.
func (s *Server) adminStartCaddyEnvDeploy(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	if s == nil || !s.CaddyHostEnvAuthoritative || s.HostControlDir == "" {
		fail(c, http.StatusServiceUnavailable, "Caddy host controller unavailable")
		return
	}
	snap, err := s.readCaddyHostEnv()
	if err != nil || !snap.PendingRedeploy {
		fail(c, http.StatusConflict, "No saved Caddy host .env awaiting deployment")
		return
	}
	// V1: the Host snapshot and the one-slot Host Control queue are the
	// deployment fences. Do not consult legacy PostgreSQL desired/Pending
	// state: it is no longer a Caddy configuration authority in this mode.
	// The Host Control runner will independently verify its pinned .env CAS.
	result, err := s.runCaddyHostEnv(c.Request.Context(), caddyHostEnvRequest{
		Operation: "deploy", ExpectedSHA256: snap.SHA256,
	})
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy deploy acknowledgement uncertain; check status before retry")
		return
	}
	if result.State != "deploying" && result.State != "deployed" && result.State != "failed" {
		fail(c, http.StatusServiceUnavailable, "Caddy host deployment state unavailable")
		return
	}
	receipt := caddyEnvDeployStatus{
		Protocol: caddyHostEnvProtocol, RequestID: result.RequestID,
		State: result.State, SHA256: snap.SHA256,
	}
	if result.State == "failed" {
		receipt.Error = safeCaddyEnvDeployError(result.Error)
		receipt.RolledBack = result.RolledBack
	}
	c.JSON(http.StatusAccepted, receipt)
}

func (s *Server) adminCaddyEnvDeployStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := c.Query("request_id")
	state, err := s.readCaddyEnvDeployStatus(id)
	if errors.Is(err, errCaddyHostEnvConflict) {
		fail(c, http.StatusBadRequest, "Invalid Caddy deployment request ID")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy deployment status unavailable")
		return
	}
	c.JSON(http.StatusOK, state)
}
