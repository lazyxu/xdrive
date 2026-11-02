package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/background"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// mediaViewerPreview renders only an authenticated foreground photo request.
// It never alters, exports or transcodes the canonical stored file.
func (s *Server) mediaViewerPreview(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
		return
	}
	format := strings.ToLower(strings.TrimSpace(c.DefaultQuery("format", "webp")))
	// Absent preset preserves existing v1 4K clients, especially DSM's strict
	// Range/ETag verifier. Only explicit opt-in may request a v2 variant.
	preset := mediapkg.ViewerQualityHigh
	rawPreset := strings.TrimSpace(c.Query("preset"))
	if rawPreset == "account" {
		if s.DB == nil {
			fail(c, http.StatusServiceUnavailable, "viewer preferences unavailable")
			return
		}
		var selected meta.ViewerQualityPreference
		err := s.DB.WithContext(c.Request.Context()).
			Where("user_id = ?", userID(c)).Take(&selected).Error
		if err == nil {
			preset, err = mediapkg.ParseViewerQualityPreset(selected.Preset)
			if err != nil || selected.Revision == 0 {
				fail(c, http.StatusServiceUnavailable, "viewer preferences unavailable")
				return
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusServiceUnavailable, "viewer preferences unavailable")
			return
		}
	} else if rawPreset != "" {
		var err error
		preset, err = mediapkg.ParseViewerQualityPreset(rawPreset)
		if err != nil {
			fail(c, http.StatusBadRequest, "invalid viewer quality preset")
			return
		}
	}
	variant, err := mediapkg.ViewerQualityVariantFor(preset, format)
	if err != nil {
		fail(c, http.StatusBadRequest, "unsupported viewer preview format")
		return
	}
	kind, ok := mediaViewerKindForVariant(variant)
	if !ok {
		fail(c, http.StatusBadRequest, "unsupported viewer quality preset")
		return
	}
	mime := "image/jpeg"
	if format == "webp" {
		mime = "image/webp"
	}
	node, err := s.ownedNode(userID(c), id, true)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if !requireMediaSourceRevision(c, node.Revision) {
		return
	}
	adminPolicy, err := s.readAdminViewerQualityMaximum(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "viewer administrator policy unavailable")
		return
	}
	resolution, err := mediapkg.ResolveViewerQuality(string(preset), "", string(adminPolicy.Maximum))
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "viewer quality policy unavailable")
		return
	}
	// Legacy clients explicitly rely on the old 4K/v1 ETag. Never silently
	// return an incompatible v2 response to DSM's strict Range validator.
	if resolution.Capped && rawPreset == "" {
		c.Header("Cache-Control", "private, no-store")
		fail(c, http.StatusForbidden, "legacy viewer exceeds administrator preview maximum")
		return
	}
	if resolution.Capped {
		preset = resolution.Effective
		variant, err = mediapkg.ViewerQualityVariantFor(preset, format)
		if err != nil {
			fail(c, http.StatusServiceUnavailable, "viewer quality policy unavailable")
			return
		}
		kind, ok = mediaViewerKindForVariant(variant)
		if !ok {
			fail(c, http.StatusServiceUnavailable, "viewer quality policy unavailable")
			return
		}
	}
	metadata, err := s.ensureMediaMetadata(c.Request.Context(), node)
	if err != nil {
		fail(c, http.StatusInternalServerError, "media indexing failed")
		return
	}
	if metadata.MediaKind != meta.MediaKindImage || !mediaThumbnailSupported(metadata) {
		fail(c, http.StatusUnsupportedMediaType, "viewer image format is not supported")
		return
	}
	key, err := mediapkg.ViewerQualityStorageKey(node.ID, node.Revision, metadata.SHA256, variant)
	if err != nil {
		fail(c, http.StatusInternalServerError, "viewer image identity unavailable")
		return
	}
	etag, err := mediapkg.ViewerQualityETag(node.ID, node.Revision, metadata.SHA256, variant)
	if err != nil {
		fail(c, http.StatusInternalServerError, "viewer image identity unavailable")
		return
	}
	c.Header("ETag", etag)
	c.Header("X-XDrive-Viewer-Preview-Edge", strconv.Itoa(variant.MaxEdge))
	c.Header("X-XDrive-Viewer-Preview-Quality", strconv.Itoa(variant.Quality))
	c.Header("X-XDrive-Viewer-Preview-Preset", string(preset))
	c.Header("X-XDrive-Viewer-Admin-Maximum", string(adminPolicy.Maximum))
	if resolution.Capped {
		c.Header("X-XDrive-Viewer-Preview-Capped", "true")
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Referrer-Policy", "no-referrer")
	// Every variant stays cacheable, but the browser MUST revalidate owner
	// permission and the current administrator maximum on each reuse.
	// A stale 1h positive browser cache could otherwise bypass a lowered cap.
	c.Header("Cache-Control", viewerPreviewHTTPRevalidation(c.Query("revision")))
	if s.tryServeMediaDerivative(c, key, node.Name+".viewer."+format,
		mime, metadata.UpdatedAt) {
		return
	}
	key, err = s.ensureMediaDerivative(c.Request.Context(), node, metadata,
		mediaDerivativeRequest{
			Kind:        kind,
			Priority:    background.PriorityP1,
			Trigger:     background.TriggerUserAction,
			Initiator:   background.InitiatorUser,
			InitiatorID: node.OwnerID,
			TraceID:     requestIDFromContext(c),
		})
	if err != nil {
		writeMediaDerivativeError(c, err, "viewer image format is not supported")
		return
	}
	if !s.tryServeMediaDerivative(c, key, node.Name+".viewer."+format,
		mime, metadata.UpdatedAt) {
		fail(c, http.StatusInternalServerError, "generated viewer preview is unavailable")
	}
}

func viewerPreviewHTTPRevalidation(revision string) string {
	if strings.TrimSpace(revision) == "" {
		return "private, no-store"
	}
	// ETag remains stable per immutable format/revision/variant. no-cache
	// allows conditional 304 reuse but requires a fresh authenticated check.
	return "private, no-cache"
}
