package api

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

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
			"scope": "host-terminal", "retention_days": 7})
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
	})
}
