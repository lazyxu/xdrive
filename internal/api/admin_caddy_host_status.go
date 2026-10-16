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
	State                   string `json:"state"`
	HTTPSConfigured         bool   `json:"https_configured"`
	TLSCheckSupported       bool   `json:"tls_check_supported"`
	TLSState                string `json:"tls_state"`
	TLSVerifiedDomainSHA256 string `json:"tls_verified_domain_sha256,omitempty"`
	RuntimeTLSAlignment     string `json:"runtime_tls_alignment,omitempty"`
	LiveConfigSHA256        string `json:"live_config_sha256,omitempty"`
}

func validCaddyHostState(state string) bool {
	switch state {
	case "healthy", "unhealthy", "starting", "running-unverified", "stopped", "unknown":
		return true
	default:
		return false
	}
}

// An observed hostname digest is optional for older Host Managers. It is
// only SHA-256 over the fixed local SNI used for the successful loopback TLS
// certificate handshake, not an authorized applied admin revision.
func validCaddyTLSVerifiedDomainDigest(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
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

// The optional startup-domain alignment belongs ONLY to the fixed running
// container. Even a match never proves an applied desired revision or WAN TLS.
func validCaddyRuntimeTLSAlignment(value string) bool {
	switch value {
	case "unverified", "matched-local", "mismatch-local":
		return true
	default:
		return false
	}
}

func caddyObservedRuntimeTLSAlignment(host caddyHostStatus, observed bool) string {
	if !observed || host.RuntimeTLSAlignment == "" ||
		host.State != "healthy" || !host.HTTPSConfigured ||
		!host.TLSCheckSupported || host.TLSState != "verified" ||
		!validCaddyTLSVerifiedDomainDigest(host.TLSVerifiedDomainSHA256) ||
		!validCaddyRuntimeTLSAlignment(host.RuntimeTLSAlignment) {
		return "unverified"
	}
	return host.RuntimeTLSAlignment
}

// GET /config/ inside the fixed Caddy container is evidence that the local
// admin API returned nonempty data, never an applied desired revision or a
// rescue ingress receipt. The raw credential-bearing JSON stays in-container.
func caddyObservedLiveConfigState(host caddyHostStatus, observed bool) string {
	if !observed || host.State != "healthy" || !host.HTTPSConfigured ||
		!host.TLSCheckSupported || host.TLSState != "verified" ||
		!validCaddyTLSVerifiedDomainDigest(host.TLSVerifiedDomainSHA256) ||
		!validCaddyTLSVerifiedDomainDigest(host.LiveConfigSHA256) {
		return "unverified"
	}
	return "observed-local"
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
		(status.TLSCheckSupported && !status.HTTPSConfigured && status.TLSState != "disabled") ||
		(status.TLSVerifiedDomainSHA256 != "" &&
			(status.TLSState != "verified" || !validCaddyTLSVerifiedDomainDigest(status.TLSVerifiedDomainSHA256))) ||
		(status.RuntimeTLSAlignment != "" &&
			(!validCaddyRuntimeTLSAlignment(status.RuntimeTLSAlignment) ||
				(status.RuntimeTLSAlignment != "unverified" &&
					(status.State != "healthy" || !status.HTTPSConfigured ||
						!status.TLSCheckSupported || status.TLSState != "verified" ||
						!validCaddyTLSVerifiedDomainDigest(status.TLSVerifiedDomainSHA256))))) ||
		(status.LiveConfigSHA256 != "" &&
			(!validCaddyTLSVerifiedDomainDigest(status.LiveConfigSHA256) ||
				status.LiveConfigSHA256 == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ||
				status.State != "healthy" || !status.HTTPSConfigured ||
				!status.TLSCheckSupported || status.TLSState != "verified" ||
				!validCaddyTLSVerifiedDomainDigest(status.TLSVerifiedDomainSHA256))) {
		return caddyHostStatus{}, false
	}
	return status, true
}
