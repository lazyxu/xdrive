package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// This is a bounded comparison of two Host-owned LOCAL observations.
// It is NOT an independently authenticated Applied Receipt, continuous
// generation attestation, disabled-ingress proof or WAN/client CA evidence.
const (
	caddyLocalUnverified = "unverified"
	caddyLocalMatching   = "matching-local"
	caddyLocalChanged    = "changed-local"
)

type caddyArchivedLocalWitness struct {
	Protocol                  string `json:"protocol"`
	State                     string `json:"state"`
	RequestID                 string `json:"request_id"`
	SHA256                    string `json:"sha256"`
	HostLocalGenerationSHA256 string `json:"host_local_generation_sha256"`
	HostLocalLiveConfigSHA256 string `json:"host_local_live_config_sha256"`
}

func parseCaddyArchivedLocalWitness(raw []byte, id, sha string) (caddyArchivedLocalWitness, bool) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || len(fields) != 6 {
		return caddyArchivedLocalWitness{}, false
	}
	for _, key := range []string{
		"protocol", "state", "request_id", "sha256",
		"host_local_generation_sha256", "host_local_live_config_sha256",
	} {
		if _, ok := fields[key]; !ok {
			return caddyArchivedLocalWitness{}, false
		}
	}
	var saved caddyArchivedLocalWitness
	if json.Unmarshal(raw, &saved) != nil ||
		saved.Protocol != caddyHostEnvProtocol || saved.State != "deployed" ||
		saved.RequestID != id || saved.SHA256 != sha ||
		!validCaddyHostEnvSHA(saved.HostLocalGenerationSHA256) ||
		!validCaddyHostEnvSHA(saved.HostLocalLiveConfigSHA256) ||
		saved.HostLocalLiveConfigSHA256 == emptyCaddyLocalConfigSHA {
		return caddyArchivedLocalWitness{}, false
	}
	return saved, true
}

const emptyCaddyLocalConfigSHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

func caddyLocalHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func (s *Server) caddyLocalRuntimeOperationClear() bool {
	if s == nil || s.HostControlDir == "" {
		return false
	}
	// Existence, symlinks and unreadable paths are all an uncertain mutation
	// window, including a request queued by a different Server replica.
	for _, name := range []string{"caddy-env-active.json", caddyHostEnvRequestName} {
		if _, err := os.Lstat(filepath.Join(s.HostControlDir, name)); !errors.Is(err, os.ErrNotExist) {
			return false
		}
	}
	return true
}

func caddyLocalObservationCoherent(env caddyHostEnvSnapshot, host caddyHostStatus) bool {
	if env.PendingRedeploy ||
		env.DomainEnabled != host.HTTPSConfigured ||
		env.LANEnabled != host.LANHTTPSConfigured ||
		host.State != "healthy" ||
		!validCaddyHostEnvSHA(host.HostLocalGenerationSHA256) ||
		!validCaddyHostEnvSHA(host.HostLocalLiveConfigSHA256) ||
		host.HostLocalLiveConfigSHA256 == emptyCaddyLocalConfigSHA ||
		!validCaddyHostLocalWitness(host) {
		return false
	}
	if env.DomainEnabled && (host.TLSState != "verified" ||
		host.RuntimeTLSAlignment != "matched-local" ||
		host.InstanceGenerationState != "same-instance-local" ||
		host.TLSVerifiedDomainSHA256 != caddyLocalHash(strings.ToLower(env.Domain))) {
		return false
	}
	if env.LANEnabled && (host.LANTLSState != "verified" ||
		host.LANVerifiedIPSHA256 != caddyLocalHash(env.LANIP)) {
		return false
	}
	return env.DomainEnabled || env.LANEnabled
}

// The result describes a RECENT (<45s) Host-local sample only. All inputs
// are rechecked after reading to avoid comparing a snapshot changed while
// the handler ran. An A-B-A transition outside these reads is not excluded;
// no caller may convert matching-local into signed or durable Applied.
func (s *Server) caddyLocalRuntimeComparison(raw []byte, id, expectedSHA string) string {
	if s == nil || !s.CaddyHostEnvAuthoritative {
		return caddyLocalUnverified
	}
	history, ok := parseCaddyArchivedLocalWitness(raw, id, expectedSHA)
	if !ok || !s.caddyLocalRuntimeOperationClear() {
		return caddyLocalUnverified
	}
	env, err := s.readCaddyHostEnv()
	if err != nil {
		return caddyLocalUnverified
	}
	host, observed := s.readCaddyHostStatus()
	if !observed || !caddyLocalObservationCoherent(env, host) {
		return caddyLocalUnverified
	}
	nextEnv, err := s.readCaddyHostEnv()
	if err != nil {
		return caddyLocalUnverified
	}
	nextHost, observed := s.readCaddyHostStatus()
	if !observed || env != nextEnv || host != nextHost ||
		!s.caddyLocalRuntimeOperationClear() {
		return caddyLocalUnverified
	}
	if env.SHA256 != history.SHA256 ||
		host.HostLocalGenerationSHA256 != history.HostLocalGenerationSHA256 ||
		host.HostLocalLiveConfigSHA256 != history.HostLocalLiveConfigSHA256 {
		return caddyLocalChanged
	}
	return caddyLocalMatching
}
