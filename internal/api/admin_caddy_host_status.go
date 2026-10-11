package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// A sanitized Host Manager observation of the fixed Caddy container.
// This reports internal HTTP reverse-proxy health, NOT external TLS validity.
const (
	caddyHostStatusName = "caddy-runtime-status.json"
	caddyHostFreshness  = 45 * time.Second
)

type caddyHostStatus struct {
	State           string `json:"state"`
	HTTPSConfigured bool   `json:"https_configured"`
}

func validCaddyHostState(state string) bool {
	switch state {
	case "healthy", "unhealthy", "starting", "running-unverified", "stopped", "unknown":
		return true
	default:
		return false
	}
}

func (s *Server) readCaddyHostStatus() (caddyHostStatus, bool) {
	var status caddyHostStatus
	if s == nil || strings.TrimSpace(s.HostControlDir) == "" {
		return status, false
	}
	for _, file := range []string{"heartbeat", caddyHostStatusName} {
		info, err := os.Lstat(filepath.Join(s.HostControlDir, file))
		if err != nil || !info.Mode().IsRegular() ||
			time.Since(info.ModTime()) > caddyHostFreshness ||
			time.Until(info.ModTime()) > 15*time.Second {
			return caddyHostStatus{}, false
		}
	}
	raw, err := os.ReadFile(filepath.Join(s.HostControlDir, caddyHostStatusName))
	if err != nil || len(raw) == 0 || len(raw) > 512 {
		return caddyHostStatus{}, false
	}
	if json.Unmarshal(raw, &status) != nil || !validCaddyHostState(status.State) {
		return caddyHostStatus{}, false
	}
	return status, true
}
