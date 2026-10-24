package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Recover a lost Start ACK from the existing single-slot Host queue/active
// operation. This read never restarts Caddy, authorizes a deployment, or
// exposes a queued Save/reveal payload (which may contain AliDNS credentials).
// A synthetic "deploying" here means accepted/pending, not physically applied.
func (s *Server) currentCaddyHostDeploy() *caddyEnvDeployStatus {
	if s == nil || s.HostControlDir == "" {
		return nil
	}
	for _, name := range []string{"caddy-env-active.json", caddyHostEnvRequestName} {
		path := filepath.Join(s.HostControlDir, name)
		info, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0007 != 0 ||
			info.Size() == 0 || info.Size() > 4096 ||
			time.Since(info.ModTime()) > 10*time.Minute ||
			time.Until(info.ModTime()) > 15*time.Second {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil || len(raw) == 0 || len(raw) > 4096 {
			return nil
		}
		var op struct {
			Operation string `json:"operation"`
			RequestID string `json:"request_id"`
			SHA256    string `json:"expected_sha256"`
		}
		if json.Unmarshal(raw, &op) != nil {
			return nil
		}
		if op.Operation != "deploy" {
			return nil
		}
		if len(op.RequestID) != 24 || strings.Trim(op.RequestID, "0123456789abcdef") != "" ||
			!validCaddyHostEnvSHA(op.SHA256) {
			return nil
		}
		if status, err := s.readCaddyEnvDeployStatus(op.RequestID); err == nil &&
			status.SHA256 == op.SHA256 {
			return &status
		}
		return &caddyEnvDeployStatus{
			Protocol: caddyHostEnvProtocol, RequestID: op.RequestID,
			SHA256: op.SHA256, State: "deploying",
		}
	}
	return nil
}

// Caddy Deploy history is the existing immutable Host terminal archive,
// NOT PostgreSQL Desired, an Applied Receipt or an unbounded audit log.
// An unsafe candidate rejects the whole list rather than silently hiding it.
func (s *Server) adminCaddyEnvDeployHistory(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	if s == nil || !s.CaddyHostEnvAuthoritative || s.HostControlDir == "" {
		fail(c, http.StatusServiceUnavailable, "Caddy Host deployment history unavailable")
		return
	}
	folder := filepath.Join(s.HostControlDir, "caddy-deploy-results")
	d, err := os.Lstat(folder)
	if errors.Is(err, os.ErrNotExist) {
		c.JSON(http.StatusOK, gin.H{"items": []caddyEnvDeployStatus{},
			"scope": "host-terminal", "retention_days": 7, "current": s.currentCaddyHostDeploy()})
		return
	}
	if err != nil || !d.IsDir() || d.Mode().Perm()&0o027 != 0 {
		fail(c, http.StatusServiceUnavailable, "Caddy Host deployment history unavailable")
		return
	}
	entries, err := os.ReadDir(folder)
	if err != nil || len(entries) > 256 {
		fail(c, http.StatusServiceUnavailable, "Caddy Host deployment history unavailable")
		return
	}
	type candidate struct {
		id string
		at time.Time
	}
	candidates := make([]candidate, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		// The Host can leave a hidden temporary inode during its atomic
		// publication. Never interpret it as a terminal result.
		if strings.HasPrefix(name, ".") {
			continue
		}
		id := strings.TrimSuffix(name, ".json")
		if !strings.HasSuffix(name, ".json") || len(id) != 24 ||
			strings.Trim(id, "0123456789abcdef") != "" {
			fail(c, http.StatusServiceUnavailable, "Caddy Host deployment history unavailable")
			return
		}
		p := filepath.Join(folder, name)
		stat, err := os.Lstat(p)
		if err != nil || !stat.Mode().IsRegular() || stat.Size() < 1 ||
			stat.Size() > 1024 || time.Until(stat.ModTime()) > 15*time.Second {
			fail(c, http.StatusServiceUnavailable, "Caddy Host deployment history unavailable")
			return
		}
		if time.Since(stat.ModTime()) > caddyDeployArchiveTTL {
			continue
		}
		candidates = append(candidates, candidate{id: id, at: stat.ModTime()})
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].at.Equal(candidates[j].at) {
			return candidates[i].id > candidates[j].id
		}
		return candidates[i].at.After(candidates[j].at)
	})
	if len(candidates) > 20 {
		candidates = candidates[:20]
	}
	items := make([]caddyEnvDeployStatus, 0, len(candidates))
	for _, item := range candidates {
		status, err := s.readCaddyEnvDeployStatus(item.id)
		if err != nil || (status.State != "deployed" && status.State != "failed") {
			fail(c, http.StatusServiceUnavailable, "Caddy Host deployment history unavailable")
			return
		}
		items = append(items, status)
	}
	c.JSON(http.StatusOK, gin.H{
		"items": items, "scope": "host-terminal", "retention_days": 7,
		"current": s.currentCaddyHostDeploy(),
	})
}
