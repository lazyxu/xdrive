package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
)

const (
	publicShareThumbnailTTL        = 90 * time.Second
	publicShareThumbnailMaxBytes   = 4 << 20
	publicShareThumbnailMaxWindows = 4096
	publicShareThumbnailTicketsPM  = 240
	publicShareThumbnailStreamsPM  = 480
)

var errPublicThumbnailUnavailable = errors.New("shared media derivative is unavailable")

type publicThumbnailWindow struct {
	start   time.Time
	tickets int
	streams int
}

var publicThumbnailAdmissions = struct {
	sync.Mutex
	windows map[uint64]publicThumbnailWindow
}{windows: make(map[uint64]publicThumbnailWindow)}

// Separate from original-preview/download metering: only bounded cached
// derivatives are admitted and no original CAS bytes are read or regenerated.
func admitPublicThumbnail(shareID uint64, now time.Time, stream bool) bool {
	publicThumbnailAdmissions.Lock()
	defer publicThumbnailAdmissions.Unlock()
	window, found := publicThumbnailAdmissions.windows[shareID]
	if !found && len(publicThumbnailAdmissions.windows) >= publicShareThumbnailMaxWindows {
		for id, old := range publicThumbnailAdmissions.windows {
			if now.Sub(old.start) >= time.Minute {
				delete(publicThumbnailAdmissions.windows, id)
			}
		}
		if len(publicThumbnailAdmissions.windows) >= publicShareThumbnailMaxWindows {
			return false
		}
	}
	if !found || now.Before(window.start) || now.Sub(window.start) >= time.Minute {
		window = publicThumbnailWindow{start: now}
	}
	if stream {
		if window.streams >= publicShareThumbnailStreamsPM {
			return false
		}
		window.streams++
	} else {
		if window.tickets >= publicShareThumbnailTicketsPM {
			return false
		}
		window.tickets++
	}
	publicThumbnailAdmissions.windows[shareID] = window
	return true
}

// Return a seekable handle ONLY to an existing, source-revision/SHA-bound,
// small jpeg/png derivative. Absence is a type icon, not a forced full-image
// decode, 32MiB original preview, thumbnail generation or background task.
func (s *Server) openPublicShareCachedThumbnail(
	ctx context.Context, node meta.Node,
) (*os.File, string, time.Time, error) {
	if node.Type != meta.NodeTypeFile || node.File == nil ||
		node.Revision == 0 || strings.TrimSpace(node.File.SHA256) == "" {
		return nil, "", time.Time{}, errPublicThumbnailUnavailable
	}
	var row meta.MediaMetadata
	if err := s.DB.WithContext(ctx).
		Where("node_id = ? AND owner_id = ? AND node_revision = ?",
			node.ID, node.OwnerID, node.Revision).Take(&row).Error; err != nil {
		return nil, "", time.Time{}, errPublicThumbnailUnavailable
	}
	if row.IndexState != meta.MediaIndexStateReady ||
		strings.TrimSpace(row.SHA256) == "" ||
		!strings.EqualFold(row.SHA256, node.File.SHA256) {
		return nil, "", time.Time{}, errPublicThumbnailUnavailable
	}
	var key string
	switch row.MediaKind {
	case meta.MediaKindImage:
		if !mediaThumbnailSupported(row) {
			return nil, "", time.Time{}, errPublicThumbnailUnavailable
		}
		key = mediaThumbnailStorageKey(node, row)
	case meta.MediaKindVideo:
		key = mediapkg.VideoPosterStorageKey(node.ID, node.Revision, row.SHA256)
	default:
		return nil, "", time.Time{}, errPublicThumbnailUnavailable
	}
	file, err := s.Store.Open(ctx, key)
	if err != nil {
		return nil, "", time.Time{}, errPublicThumbnailUnavailable
	}
	bad := func() (*os.File, string, time.Time, error) {
		_ = file.Close()
		return nil, "", time.Time{}, errPublicThumbnailUnavailable
	}
	stat, err := file.Stat()
	if err != nil || stat.Size() < 45 || stat.Size() > publicShareThumbnailMaxBytes ||
		!mediaDerivativeCacheValid(file, key) {
		return bad()
	}
	var header [8]byte
	var trailer [12]byte
	if _, err := file.ReadAt(header[:], 0); err != nil {
		return bad()
	}
	if _, err := file.ReadAt(trailer[:], stat.Size()-int64(len(trailer))); err != nil {
		return bad()
	}
	mime := ""
	if stat.Size() >= 64 && header[0] == 0xff && header[1] == 0xd8 &&
		header[2] == 0xff && trailer[10] == 0xff && trailer[11] == 0xd9 {
		mime = "image/jpeg"
	} else if row.MediaKind == meta.MediaKindImage &&
		bytes.Equal(header[:], mediaDerivativePNGSignature) &&
		bytes.Equal(trailer[:], mediaDerivativePNGIEND) {
		mime = "image/png"
	}
	if mime == "" {
		return bad()
	}
	return file, mime, row.UpdatedAt, nil
}

type publicShareThumbnailTicketDTO struct {
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
	MIMEType  string    `json:"mime_type"`
}

func (s *Server) publicShareThumbnailTicket(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	share, root, err := s.resolvePublicShare(
		c.Request.Context(), c.GetHeader("X-XDrive-Share-Token"), time.Now().UTC(),
	)
	if err != nil {
		writePublicShareLookupError(c, err)
		return
	}
	var req struct {
		Password string `json:"password"`
		NodeID   uint64 `json:"node_id"`
		Revision uint64 `json:"revision"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "invalid thumbnail request")
		return
	}
	if share.PasswordHash != "" &&
		(req.Password == "" || auth.CheckPassword(share.PasswordHash, req.Password) != nil) {
		fail(c, http.StatusUnauthorized, "share_password_invalid")
		return
	}
	target := root
	switch root.Type {
	case meta.NodeTypeFile:
		if req.NodeID != 0 && req.NodeID != root.ID {
			fail(c, http.StatusNotFound, "shared thumbnail not found")
			return
		}
	case meta.NodeTypeDir:
		if req.NodeID == 0 {
			fail(c, http.StatusBadRequest, "node_id required for shared folder thumbnail")
			return
		}
		allowed, lookupErr := s.publicFolderShareContainsNode(
			c.Request.Context(), share.OwnerID, root.ID, req.NodeID)
		if lookupErr != nil {
			fail(c, http.StatusInternalServerError, "shared thumbnail scope lookup failed")
			return
		}
		if !allowed {
			fail(c, http.StatusNotFound, "shared thumbnail not found")
			return
		}
		// GORM First(&target) silently adds a primary-key predicate when the
		// struct still holds root.ID. Clear it before loading an authorized
		// *different* descendant, or valid share children incorrectly return 404.
		target = meta.Node{}
		if lookupErr := s.DB.WithContext(c.Request.Context()).Preload("File").
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				req.NodeID, share.OwnerID, meta.NodeTypeFile).First(&target).Error; lookupErr != nil {
			fail(c, http.StatusNotFound, "shared thumbnail not found")
			return
		}
	default:
		fail(c, http.StatusNotFound, "shared thumbnail not found")
		return
	}
	if req.Revision != 0 && req.Revision != target.Revision {
		fail(c, http.StatusConflict, "shared thumbnail source changed")
		return
	}
	file, mime, _, err := s.openPublicShareCachedThumbnail(c.Request.Context(), target)
	if err != nil {
		fail(c, http.StatusNotFound, "shared cached thumbnail not found")
		return
	}
	_ = file.Close()
	if !admitPublicThumbnail(share.ID, time.Now(), false) {
		c.Header("Retry-After", "60")
		fail(c, http.StatusTooManyRequests, "shared thumbnail rate limit")
		return
	}
	ticket, expires, err := s.Auth.IssuePublicShareThumbnail(
		share.ID, target.ID, target.Revision, publicShareThumbnailTTL)
	if err != nil {
		fail(c, http.StatusInternalServerError, "issue shared thumbnail ticket failed")
		return
	}
	c.JSON(http.StatusOK, publicShareThumbnailTicketDTO{
		URL: fmt.Sprintf("/api/v1/public-share-thumbnail/%d?ticket=%s",
			share.ID, url.QueryEscape(ticket)),
		ExpiresAt: expires.UTC(), MIMEType: mime,
	})
}

// Revalidate ShareID, owner, root/descendant, revision and actual cached bytes
// for GET and HEAD. The ticket cannot be used for original preview/download.
func (s *Server) publicShareThumbnailStream(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	shareID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid thumbnail share id")
		return
	}
	claims, err := s.Auth.ParsePublicShareThumbnail(strings.TrimSpace(c.Query("ticket")))
	if err != nil || claims.ShareID != shareID {
		fail(c, http.StatusUnauthorized, "invalid shared thumbnail ticket")
		return
	}
	var share meta.Share
	if err := s.DB.WithContext(c.Request.Context()).First(&share, shareID).Error; err != nil {
		writePublicShareLookupError(c, err)
		return
	}
	if shareStatus(share, time.Now().UTC()) != "active" {
		fail(c, http.StatusGone, "shared thumbnail no longer available")
		return
	}
	var owner meta.User
	if err := s.DB.WithContext(c.Request.Context()).Select("id", "disabled_at").
		First(&owner, share.OwnerID).Error; err != nil || owner.DisabledAt != nil {
		fail(c, http.StatusGone, "shared thumbnail owner unavailable")
		return
	}
	var root meta.Node
	if err := s.DB.WithContext(c.Request.Context()).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL",
			share.NodeID, share.OwnerID).First(&root).Error; err != nil {
		fail(c, http.StatusGone, "shared thumbnail root unavailable")
		return
	}
	if root.ID != claims.NodeID {
		if root.Type != meta.NodeTypeDir {
			fail(c, http.StatusGone, "shared thumbnail scope changed")
			return
		}
		allowed, err := s.publicFolderShareContainsNode(
			c.Request.Context(), share.OwnerID, root.ID, claims.NodeID)
		if err != nil || !allowed {
			fail(c, http.StatusGone, "shared thumbnail scope changed")
			return
		}
	}
	var node meta.Node
	if err := s.DB.WithContext(c.Request.Context()).Preload("File").
		Where("id = ? AND owner_id = ? AND type = ? AND revision = ? AND deleted_at IS NULL",
			claims.NodeID, share.OwnerID, meta.NodeTypeFile, claims.NodeRevision).
		First(&node).Error; err != nil || node.File == nil {
		fail(c, http.StatusGone, "shared thumbnail source changed")
		return
	}
	file, mime, modifiedAt, err := s.openPublicShareCachedThumbnail(c.Request.Context(), node)
	if err != nil {
		fail(c, http.StatusNotFound, "shared cached thumbnail unavailable")
		return
	}
	defer file.Close()
	if !admitPublicThumbnail(share.ID, time.Now(), true) {
		c.Header("Retry-After", "60")
		fail(c, http.StatusTooManyRequests, "shared thumbnail stream rate limit")
		return
	}
	c.Header("Content-Type", mime)
	c.Header("Content-Disposition", "inline; filename*=UTF-8''"+url.PathEscape(node.Name))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cross-Origin-Resource-Policy", "same-origin")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("Content-Security-Policy", "default-src 'none'; sandbox")
	c.Header("ETag", fmt.Sprintf("\"shared-thumbnail-%d-%d\"", node.ID, node.Revision))
	http.ServeContent(c.Writer, c.Request, node.Name, modifiedAt, file)
}
