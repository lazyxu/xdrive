package api

import (
	"context"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const mediaVideoTicketTTL = 2 * time.Hour

type mediaVideoTicketDTO struct {
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (s *Server) mediaVideoTicket(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
		return
	}
	node, err := s.ownedNode(userID(c), id, true)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusNotFound, "media not found")
		return
	}
	metadata, err := s.ensureMediaMetadata(c.Request.Context(), node)
	if err != nil {
		fail(c, http.StatusInternalServerError, "media indexing failed")
		return
	}
	if metadata.MediaKind != meta.MediaKindVideo || metadata.IndexState != meta.MediaIndexStateReady {
		fail(c, http.StatusUnsupportedMediaType, "media is not a playable video")
		return
	}
	user, ok := currentUser(c)
	if !ok {
		fail(c, http.StatusUnauthorized, "user not found")
		return
	}
	ticket, expiresAt, err := s.Auth.IssueMediaStream(
		user.ID,
		user.SessionVersion,
		node.ID,
		node.Revision,
		mediaVideoTicketTTL,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "create media playback ticket failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, mediaVideoTicketDTO{
		URL: fmt.Sprintf(
			"/api/v1/media/play/%d?ticket=%s",
			node.ID,
			url.QueryEscape(ticket),
		),
		ExpiresAt: expiresAt.UTC(),
	})
}

func (s *Server) mediaVideo(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
		return
	}
	node, metadata, err := s.ownedPlayableVideo(c.Request.Context(), userID(c), id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "playable video not found")
		} else {
			fail(c, http.StatusInternalServerError, "resolve playable video failed")
		}
		return
	}
	s.serveMediaVideo(c, node, metadata)
}

func (s *Server) mediaVideoTicketStream(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
		return
	}
	claims, err := s.Auth.ParseMediaStream(strings.TrimSpace(c.Query("ticket")))
	if err != nil || claims.NodeID != id {
		fail(c, http.StatusUnauthorized, "invalid media playback ticket")
		return
	}

	var user meta.User
	if err := s.DB.WithContext(c.Request.Context()).First(&user, claims.UserID).Error; err != nil {
		fail(c, http.StatusUnauthorized, "invalid media playback ticket")
		return
	}
	if user.DisabledAt != nil ||
		user.MustChangePassword ||
		claims.SessionVersion != user.SessionVersion {
		fail(c, http.StatusUnauthorized, "media playback ticket is no longer valid")
		return
	}

	node, metadata, err := s.ownedPlayableVideo(c.Request.Context(), claims.UserID, id)
	if err != nil {
		fail(c, http.StatusNotFound, "playable video not found")
		return
	}
	if node.Revision != claims.NodeRevision {
		fail(c, http.StatusGone, "media playback ticket is stale")
		return
	}
	s.serveMediaVideo(c, node, metadata)
}

func (s *Server) ownedPlayableVideo(
	ctx context.Context,
	uid, nodeID uint64,
) (meta.Node, meta.MediaMetadata, error) {
	var node meta.Node
	if err := s.DB.WithContext(ctx).
		Preload("File").
		Where(
			"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			nodeID,
			uid,
			meta.NodeTypeFile,
		).
		First(&node).Error; err != nil {
		return node, meta.MediaMetadata{}, err
	}
	if node.File == nil {
		return node, meta.MediaMetadata{}, gorm.ErrRecordNotFound
	}
	var metadata meta.MediaMetadata
	if err := s.DB.WithContext(ctx).
		Where(
			"node_id = ? AND owner_id = ? AND media_kind = ? AND index_state = ?",
			node.ID,
			uid,
			meta.MediaKindVideo,
			meta.MediaIndexStateReady,
		).
		First(&metadata).Error; err != nil {
		return node, metadata, err
	}
	return node, metadata, nil
}

func (s *Server) serveMediaVideo(
	c *gin.Context,
	node meta.Node,
	metadata meta.MediaMetadata,
) {
	file, err := s.Store.Open(c.Request.Context(), node.File.StorageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "stored content not found")
		return
	}
	defer file.Close()

	contentType := strings.TrimSpace(metadata.MIMEType)
	if contentType == "" {
		contentType = strings.TrimSpace(mime.TypeByExtension(strings.ToLower(filepath.Ext(node.Name))))
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", "inline; filename*=UTF-8''"+url.PathEscape(node.Name))
	c.Header("Content-Type", contentType)
	c.Header("Cache-Control", "private, no-store")
	if sha := strings.ToLower(strings.TrimSpace(node.File.SHA256)); sha != "" {
		c.Header("ETag", fmt.Sprintf("\"media-video-%s\"", sha))
	} else {
		c.Header("ETag", fmt.Sprintf("\"media-video-%d-%d\"", node.ID, node.Revision))
	}
	http.ServeContent(c.Writer, c.Request, node.Name, node.File.UpdatedAt, file)
}
