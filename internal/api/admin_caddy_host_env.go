package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	caddyHostEnvSnapshotName = "caddy-env-observed.json"
	caddyHostEnvRequestName  = "caddy-env-request.json"
	caddyHostEnvResultName   = "caddy-env-result.json"
	caddyHostEnvSecretName   = "caddy-env-secret-result.json"
	caddyHostEnvProtocol     = "xdrive.caddy.host-env.v1"
	caddyHostEnvFreshness    = 45 * time.Second
)

var errCaddyHostEnvUnavailable = errors.New("host Caddy .env authority unavailable")
var errCaddyHostEnvConflict = errors.New("host Caddy .env changed or operation in progress")

type caddyHostEnvSnapshot struct {
	Protocol         string    `json:"protocol"`
	Domain           string    `json:"domain"`
	DomainEnabled    bool      `json:"domain_enabled"`
	LANIP            string    `json:"lan_ip"`
	LANEnabled       bool      `json:"lan_enabled"`
	AliDNSConfigured bool      `json:"alidns_configured"`
	SHA256           string    `json:"sha256"`
	PendingRedeploy  bool      `json:"pending_redeploy"`
	ObservedAt       time.Time `json:"observed_at"`
}

type caddyHostEnvRequest struct {
	Operation      string                  `json:"operation"`
	RequestID      string                  `json:"request_id"`
	CreatedAt      string                  `json:"created_at"`
	ExpectedSHA256 string                  `json:"expected_sha256"`
	HTTPS          *atomicCaddyHTTPSInput  `json:"https,omitempty"`
	AliDNS         *atomicCaddyAliDNSInput `json:"alidns,omitempty"`
}
type caddyHostEnvResult struct {
	caddyHostEnvSnapshot
	RequestID        string `json:"request_id"`
	State            string `json:"state"`
	Error            string `json:"error,omitempty"`
	AccessKeyID      string `json:"access_key_id,omitempty"`
	AccessKeySecret  string `json:"access_key_secret,omitempty"`
	ExpiresInSeconds int    `json:"expires_in_seconds,omitempty"`
}

func validCaddyHostEnvSHA(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, c := range value {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

// The HOST-owned file is the single configuration source. This nonsecret
// observation is not the Caddy live config or a trusted Applied receipt.
func (s *Server) readCaddyHostEnv() (caddyHostEnvSnapshot, error) {
	if s == nil || strings.TrimSpace(s.HostControlDir) == "" {
		return caddyHostEnvSnapshot{}, errCaddyHostEnvUnavailable
	}
	for _, name := range []string{"heartbeat", caddyHostEnvSnapshotName} {
		st, err := os.Lstat(filepath.Join(s.HostControlDir, name))
		if err != nil || !st.Mode().IsRegular() || time.Since(st.ModTime()) > caddyHostEnvFreshness || time.Until(st.ModTime()) > 15*time.Second {
			return caddyHostEnvSnapshot{}, errCaddyHostEnvUnavailable
		}
	}
	raw, err := os.ReadFile(filepath.Join(s.HostControlDir, caddyHostEnvSnapshotName))
	if err != nil || len(raw) == 0 || len(raw) > 1024 {
		return caddyHostEnvSnapshot{}, errCaddyHostEnvUnavailable
	}
	var snap caddyHostEnvSnapshot
	if json.Unmarshal(raw, &snap) != nil || snap.Protocol != caddyHostEnvProtocol ||
		!validCaddyHostEnvSHA(snap.SHA256) ||
		snap.DomainEnabled != (snap.Domain != "") || snap.LANEnabled != (snap.LANIP != "") ||
		(snap.Domain != "" && !validCaddyHTTPSDomain(snap.Domain)) ||
		(snap.LANIP != "" && !validCaddyLANIP(snap.LANIP)) ||
		snap.ObservedAt.IsZero() || time.Since(snap.ObservedAt) > caddyHostEnvFreshness ||
		time.Until(snap.ObservedAt) > 15*time.Second {
		return caddyHostEnvSnapshot{}, errCaddyHostEnvUnavailable
	}
	return snap, nil
}

// Go's map JSON ordering agrees with the restricted ASCII Python Host map.
// The digest never substitutes for authorization or TLS verification.
func caddyHostEnvFingerprint(domain, lan, keyID, secret string) string {
	values := map[string]string{
		"XD_DOMAIN": domain, "XD_LAN_HTTPS_IP": lan,
		"ALIYUN_ACCESS_KEY_ID": keyID, "ALIYUN_ACCESS_KEY_SECRET": secret,
	}
	raw, _ := json.Marshal(values)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// Admin and PG audit gates are enforced by the caller. Publish a fixed,
// no-clobber request; the Host process owns env and Docker. The request may
// contain AliDNS values, so neither the request nor error are ever logged.
func (s *Server) runCaddyHostEnv(ctx context.Context, request caddyHostEnvRequest) (caddyHostEnvResult, error) {
	var zero caddyHostEnvResult
	if ctx == nil || ctx.Err() != nil || !validCaddyHostEnvSHA(request.ExpectedSHA256) ||
		(request.Operation != "save" && request.Operation != "commit" && request.Operation != "restore" &&
			request.Operation != "deploy" && request.Operation != "reveal") ||
		(request.Operation != "save" && (request.HTTPS != nil || request.AliDNS != nil)) ||
		(request.Operation == "save" && request.HTTPS == nil && request.AliDNS == nil) {
		return zero, errCaddyHostEnvConflict
	}
	if _, err := s.readCaddyHostEnv(); err != nil {
		return zero, errCaddyHostEnvUnavailable
	}
	id, err := randomServerUpdateRequestID()
	if err != nil {
		return zero, errCaddyHostEnvUnavailable
	}
	request.RequestID = id
	request.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	payload, err := json.Marshal(request)
	if err != nil || len(payload) > 4096 {
		return zero, errCaddyHostEnvConflict
	}
	dir := s.HostControlDir
	temp, err := os.CreateTemp(dir, ".caddy-env-request-*.tmp")
	if err != nil {
		return zero, errCaddyHostEnvUnavailable
	}
	defer os.Remove(temp.Name())
	if temp.Chmod(0660) != nil {
		_ = temp.Close()
		return zero, errCaddyHostEnvUnavailable
	}
	if _, err := temp.Write(append(payload, '\n')); err != nil {
		_ = temp.Close()
		return zero, errCaddyHostEnvUnavailable
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return zero, errCaddyHostEnvUnavailable
	}
	if err := temp.Close(); err != nil {
		return zero, errCaddyHostEnvUnavailable
	}
	if err := os.Link(temp.Name(), filepath.Join(dir, caddyHostEnvRequestName)); err != nil {
		if errors.Is(err, os.ErrExist) {
			return zero, errCaddyHostEnvConflict
		}
		return zero, errCaddyHostEnvUnavailable
	}
	deadline := time.NewTimer(12 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return zero, errCaddyHostEnvUnavailable
		case <-deadline.C:
			return zero, errCaddyHostEnvUnavailable
		case <-tick.C:
			path := filepath.Join(dir, caddyHostEnvResultName)
			if request.Operation == "reveal" {
				path = filepath.Join(dir, caddyHostEnvSecretName)
			}
			st, err := os.Lstat(path)
			if err != nil || !st.Mode().IsRegular() || time.Since(st.ModTime()) > 45*time.Second {
				continue
			}
			raw, err := os.ReadFile(path)
			if err != nil || len(raw) == 0 || len(raw) > 1024 {
				continue
			}
			var result caddyHostEnvResult
			if json.Unmarshal(raw, &result) != nil || result.RequestID != id {
				continue
			}
			if !validCaddyHostEnvSHA(result.SHA256) || result.Protocol != caddyHostEnvProtocol {
				return zero, errCaddyHostEnvUnavailable
			}
			switch request.Operation {
			case "save":
				if result.State != "saved" {
					return zero, errCaddyHostEnvUnavailable
				}
			case "reveal":
				if result.State != "revealed" || result.SHA256 != request.ExpectedSHA256 ||
					result.ExpiresInSeconds != 30 || !validCaddyAliDNSPair(caddyAliDNSSecretPair{
					AccessKeyID: result.AccessKeyID, AccessKeySecret: result.AccessKeySecret,
				}) || time.Since(st.ModTime()) > 30*time.Second {
					return zero, errCaddyHostEnvUnavailable
				}
				// Read-once private result: clear it before returning credentials
				// to the HTTP handler, even if the browser later disconnects.
				if err := os.Remove(path); err != nil {
					return zero, errCaddyHostEnvUnavailable
				}
			case "deploy":
				if result.State != "deploying" && result.State != "deployed" && result.State != "failed" {
					return zero, errCaddyHostEnvUnavailable
				}
				if result.SHA256 != request.ExpectedSHA256 {
					return zero, errCaddyHostEnvUnavailable
				}
			case "commit":
				if result.State != "committed" {
					return zero, errCaddyHostEnvUnavailable
				}
			case "restore":
				if result.State != "restored" {
					return zero, errCaddyHostEnvUnavailable
				}
			}
			return result, nil
		}
	}
}

func (s *Server) caddyHostEnvMatchesHistoricalPair(domain, lan, keyID, secret string) bool {
	snap, err := s.readCaddyHostEnv()
	return err == nil && snap.SHA256 == caddyHostEnvFingerprint(domain, lan, keyID, secret)
}

func verifyCaddyHostEnvAck(result caddyHostEnvResult) error {
	if result.State != "saved" || !result.PendingRedeploy || !validCaddyHostEnvSHA(result.SHA256) {
		return fmt.Errorf("%w: missing host save proof", errCaddyHostEnvUnavailable)
	}
	return nil
}
