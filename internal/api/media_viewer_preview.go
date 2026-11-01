package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/background"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
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
	var kind mediaDerivativeKind
	var mime string
	var quality int
	switch format {
	case "webp":
		kind = mediaDerivativeViewerWebP
		mime = "image/webp"
		quality = mediapkg.ViewerPreviewWebPQuality
	case "jpeg":
		kind = mediaDerivativeViewerJPEG
		mime = "image/jpeg"
		quality = mediapkg.ViewerPreviewJPEGQuality
	default:
		fail(c, http.StatusBadRequest, "unsupported viewer preview format")
		return
	}
	node, err := s.ownedNode(userID(c), id, true)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if !requireMediaSourceRevision(c, node.Revision) {
		return
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
	key := mediapkg.ViewerPreviewStorageKey(node.ID, node.Revision, metadata.SHA256, format)
	c.Header("ETag", mediapkg.ViewerPreviewETag(node.ID, node.Revision, metadata.SHA256, format))
	c.Header("X-XDrive-Viewer-Preview-Edge", strconv.Itoa(mediapkg.ViewerPreviewEdge))
	c.Header("X-XDrive-Viewer-Preview-Quality", strconv.Itoa(quality))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Referrer-Policy", "no-referrer")
	if strings.TrimSpace(c.Query("revision")) != "" {
		c.Header("Cache-Control", "private, max-age=3600")
	} else {
		c.Header("Cache-Control", "private, no-store")
	}
	if s.tryServeMediaDerivative(c, key, node.Name+".viewer."+format,
		mime, metadata.UpdatedAt) {
		return
	}
	key, err = s.ensureMediaDerivative(c.Request.Context(), node, metadata,
		mediaDerivativeRequest{
			Kind: kind,
			Priority: background.PriorityP1,
			Trigger: background.TriggerUserAction,
			Initiator: background.InitiatorUser,
			InitiatorID: node.OwnerID,
			TraceID: requestIDFromContext(c),
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
