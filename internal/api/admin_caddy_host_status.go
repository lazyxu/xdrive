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
	State             string `json:"state"`
	HTTPSConfigured   bool   `json:"https_configured"`
	TLSCheckSupported bool   `json:"tls_check_supported"`
	TLSState          string `json:"tls_state"`
}

func validCaddyHostState(state string) bool {
	switch state {
	case "healthy", "unhealthy", "starting", "running-unverified", "stopped", "unknown":
		return true
	default:
		return false
	}
}

// TLS state records ONLY an authenticated local loopback handshake with trusted
// host configuration and certificate hostname validation, never public reachability.
func validCaddyTLSState(state string) bool {
	switch state {
	case "disabled", "verified", "failed", "unavailable", "invalid-config":
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
	if json.Unmarshal(raw, &status) != nil || !validCaddyHostState(status.State) ||
		(status.TLSCheckSupported && !validCaddyTLSState(status.TLSState)) ||
		(!status.TLSCheckSupported && status.TLSState != "") ||
		(status.TLSState == "verified" && (!status.HTTPSConfigured || status.State != "healthy")) ||
		(status.TLSCheckSupported && status.HTTPSConfigured && status.TLSState == "disabled") ||
		(status.TLSCheckSupported && !status.HTTPSConfigured && status.TLSState != "disabled") {
		return caddyHostStatus{}, false
	}
	return status, true
}
