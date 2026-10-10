package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

type adminGeoNamesConfigDTO struct {
	DatasetConfigured bool    `json:"dataset_configured"`
	ReloadSupported   bool    `json:"reload_supported"`
	Source            string  `json:"source"`
	CurrentVersion    string  `json:"current_version"`
	MaxDistanceKM     float64 `json:"max_distance_km"`
	RequiresRestart   bool    `json:"requires_restart"`
}

// GeoNames dataset paths are deliberately not accepted from HTTP. A trusted,
// read-only deployment mount is the sole dataset source in this first phase.
func (s *Server) adminGeoNamesConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	version := ""
	if s.GeoNamesRuntime != nil {
		version = s.GeoNamesRuntime.Version()
	}
	c.JSON(http.StatusOK, adminGeoNamesConfigDTO{
		DatasetConfigured: strings.TrimSpace(s.GeoNamesDataDir) != "" && version != "",
		ReloadSupported: s.DB != nil && s.GeoNamesRuntime != nil &&
			strings.TrimSpace(s.GeoNamesDataDir) != "" && version != "",
		Source:          "deployment",
		CurrentVersion:  version,
		MaxDistanceKM:   s.GeoNamesMaxDistanceKM,
		RequiresRestart: false,
	})
}

func (s *Server) adminGeoNamesReload(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.DB == nil || s.GeoNamesRuntime == nil ||
		strings.TrimSpace(s.GeoNamesDataDir) == "" {
		fail(c, http.StatusServiceUnavailable, "GeoNames dataset reload is not configured")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		ExpectedVersion string `json:"expected_version"`
	}
	if err := c.ShouldBindJSON(&input); err != nil ||
		len(input.ExpectedVersion) == 0 || len(input.ExpectedVersion) > 128 {
		fail(c, http.StatusBadRequest, "GeoNames expected version is required")
		return
	}
	if !s.geoNamesReloadMu.TryLock() {
		fail(c, http.StatusConflict, "GeoNames reload is already running")
		return
	}
	defer s.geoNamesReloadMu.Unlock()

	current := s.GeoNamesRuntime.Snapshot()
	if current == nil || current.Version() != input.ExpectedVersion {
		fail(c, http.StatusConflict, "GeoNames dataset changed; refresh and retry")
		return
	}
	// Always build a fresh, fully validated immutable index BEFORE publishing it.
	// A bad or partial data update must leave existing tasks and the active version intact.
	next, err := photointelligence.LoadGeoNamesResolver(
		s.GeoNamesDataDir, s.GeoNamesMaxDistanceKM,
	)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "GeoNames dataset validation failed; active version retained")
		return
	}
	if c.Request.Context().Err() != nil {
		return
	}
	previousVersion := current.Version()
	changed := next.Version() != previousVersion
	// Persist a no-secret admin audit BEFORE changing the live pointer. Without
	// a working audit database, the reload is not authorized to take effect.
	if err := recordAuditTx(s.DB.WithContext(c.Request.Context()), auditEventFromContext(
		c, "admin.service.geonames.reload", "service", "geonames",
		"GeoNames 离线地名", auditpkg.ResultSuccess,
		map[string]any{"changed": changed, "previous_version": previousVersion, "next_version": next.Version()},
	)); err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames reload audit is unavailable")
		return
	}
	if changed {
		s.GeoNamesRuntime.Swap(next)
	}
	c.JSON(http.StatusOK, gin.H{
		"applied": true, "changed": changed, "previous_version": previousVersion,
		"current_version": s.GeoNamesRuntime.Version(),
		"checked_at":      time.Now().UTC().Format(time.RFC3339),
	})
}
