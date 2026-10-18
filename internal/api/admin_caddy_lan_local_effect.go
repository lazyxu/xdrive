package api

import (
	"crypto/sha256"
	"encoding/hex"
)

// A verified local IP-SAN TLS handshake is only a point-in-time observation,
// not a Caddy host application receipt or externally trusted browser session.
func caddyLANLocalEffectState(host caddyHostStatus, observed bool, lanIP string) string {
	if !observed {
		return "unknown"
	}
	if lanIP == "" && !host.LANHTTPSConfigured && host.LANTLSState == "disabled" {
		return "disabled"
	}
	if !validCaddyLANIP(lanIP) {
		return "unknown"
	}
	if !host.LANHTTPSConfigured {
		return "unavailable"
	}
	switch host.LANTLSState {
	case "failed", "unavailable", "invalid-config":
		return host.LANTLSState
	case "verified":
		digest := sha256.Sum256([]byte(lanIP))
		if host.State == "healthy" &&
			host.LANVerifiedIPSHA256 == hex.EncodeToString(digest[:]) {
			return "verified"
		}
		return "unavailable"
	default:
		return "unknown"
	}
}
