package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

const (
	publicSharePreviewTicketTTL = 90 * time.Second
	publicSharePreviewMaxBytes  = 32 << 20
	publicSharePreviewWindows   = 4096
	publicSharePreviewTicketsPM = 48
	publicSharePreviewStreamsPM = 96
)

var errPublicPreviewMedia = errors.New("unsafe or unsupported shared preview")

type publicPreviewWindow struct {
	start   time.Time
	tickets int
	streams int
}

// Bounded, per-instance, share-scoped preview rate admission. This is not a
// distributed cross-replica quota; no download-count quota is consumed.
var publicPreviewAdmissions = struct {
	sync.Mutex
	windows map[uint64]publicPreviewWindow
}{windows: make(map[uint64]publicPreviewWindow)}

func admitPublicSharePreview(shareID uint64, now time.Time, stream bool) bool {
	publicPreviewAdmissions.Lock()
	defer publicPreviewAdmissions.Unlock()

	windows := publicPreviewAdmissions.windows
	window, found := windows[shareID]
	if !found && len(windows) >= publicSharePreviewWindows {
		for id, value := range windows {
			if now.Sub(value.start) >= time.Minute {
				delete(windows, id)
			}
		}
		if len(windows) >= publicSharePreviewWindows {
			return false
		}
	}
	if !found || now.Before(window.start) || now.Sub(window.start) >= time.Minute {
		window = publicPreviewWindow{start: now}
	}
	if stream {
		if window.streams >= publicSharePreviewStreamsPM {
			return false
		}
		window.streams++
	} else {
		if window.tickets >= publicSharePreviewTicketsPM {
			return false
		}
		window.tickets++
	}
	windows[shareID] = window
	return true
}

var publicSharePreviewImageMIMEs = map[string]string{
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".webp": "image/webp",
	".gif":  "image/gif",
}

func (s *Server) publicSharePreviewMIME(ctx context.Context, node meta.Node) (string, error) {
	if node.Type != meta.NodeTypeFile || node.File == nil ||
		node.File.Size <= 0 || node.File.Size > publicSharePreviewMaxBytes {
		return "", errPublicPreviewMedia
	}
	expected, ok := publicSharePreviewImageMIMEs[strings.ToLower(filepath.Ext(node.Name))]
	if !ok {
		return "", errPublicPreviewMedia
	}
	file, err := s.Store.Open(ctx, node.File.StorageKey)
	if err != nil {
		return "", err
	}
	defer file.Close()
	sniff := make([]byte, 512)
	count, readErr := io.ReadFull(file, sniff)
	if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, io.ErrUnexpectedEOF) {
		return "", readErr
	}
	if count == 0 || http.DetectContentType(sniff[:count]) != expected {
		return "", errPublicPreviewMedia
	}
	return expected, nil
}

type publicSharePreviewTicketDTO struct {
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
	MIMEType  string    `json:"mime_type"`
}

// A public link can issue a separate, short-lived image preview ticket for
// its own File or a current descendant File, never for a whole private account.
func (s *Server) publicSharePreviewTicket(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	rawToken := strings.TrimSpace(c.GetHeader("X-XDrive-Share-Token"))
	share, root, err := s.resolvePublicShare(c.Request.Context(), rawToken, time.Now())
	if err != nil {
		writePublicShareLookupError(c, err)
		return
	}
	var req struct {
		Password string `json:"password"`
		NodeID   uint64 `json:"node_id"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if share.PasswordHash != "" &&
		(req.Password == "" || auth.CheckPassword(share.PasswordHash, req.Password) != nil) {
		fail(c, http.StatusUnauthorized, "share_password_invalid")
		return
	}
	target := root
	if root.Type == meta.NodeTypeFile {
		if req.NodeID != 0 && req.NodeID != root.ID {
			fail(c, http.StatusNotFound, "shared preview not found")
			return
		}
	} else if root.Type == meta.NodeTypeDir {
		if req.NodeID == 0 {
			fail(c, http.StatusBadRequest, "node_id required for folder preview")
			return
		}
		allowed, lookupErr := s.publicFolderShareContainsNode(
			c.Request.Context(), share.OwnerID, root.ID, req.NodeID)
		if lookupErr != nil {
			fail(c, http.StatusInternalServerError, "share scope lookup failed")
			return
		}
		if !allowed {
			fail(c, http.StatusNotFound, "shared preview not found")
			return
		}
		target = meta.Node{}
		if lookupErr := s.DB.WithContext(c.Request.Context()).Preload("File").
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				req.NodeID, share.OwnerID, meta.NodeTypeFile).First(&target).Error; lookupErr != nil {
			fail(c, http.StatusNotFound, "shared preview not found")
			return
		}
	} else {
		fail(c, http.StatusNotFound, "shared preview not found")
		return
	}
	mime, err := s.publicSharePreviewMIME(c.Request.Context(), target)
	if err != nil {
		fail(c, http.StatusUnsupportedMediaType, "shared image preview unsupported")
		return
	}
	if !admitPublicSharePreview(share.ID, time.Now(), false) {
		c.Header("Retry-After", "60")
		fail(c, http.StatusTooManyRequests, "shared preview rate limit")
		return
	}
	// Stream rechecks share status, owner, current descendant scope, MIME and
	// exact NodeRevision, even if the image changes after ticket issuance.
	ticket, expires, err := s.Auth.IssuePublicSharePreview(
		share.ID, target.ID, target.Revision, publicSharePreviewTicketTTL)
	if err != nil {
		fail(c, http.StatusInternalServerError, "create shared preview failed")
		return
	}
	c.JSON(http.StatusOK, publicSharePreviewTicketDTO{
		URL: fmt.Sprintf("/api/v1/public-share-preview/%d?ticket=%s",
			share.ID, url.QueryEscape(ticket)),
		ExpiresAt: expires.UTC(),
		MIMEType:  mime,
	})
}

// Every GET/HEAD reauthorizes the current share and exact raster original.
// It never accepts an account JWT or a file-download ticket as authority.
func (s *Server) publicSharePreviewStream(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	shareID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid share id")
		return
	}
	claims, err := s.Auth.ParsePublicSharePreview(strings.TrimSpace(c.Query("ticket")))
	if err != nil || claims.ShareID != shareID {
		fail(c, http.StatusUnauthorized, "invalid public preview ticket")
		return
	}
	var share meta.Share
	if err := s.DB.WithContext(c.Request.Context()).First(&share, shareID).Error; err != nil {
		writePublicShareLookupError(c, err)
		return
	}
	if shareStatus(share, time.Now()) != "active" {
		fail(c, http.StatusGone, "shared preview no longer available")
		return
	}
	var owner meta.User
	if err := s.DB.WithContext(c.Request.Context()).Select("id", "disabled_at").
		First(&owner, share.OwnerID).Error; err != nil || owner.DisabledAt != nil {
		fail(c, http.StatusGone, "shared preview no longer available")
		return
	}
	var root meta.Node
	if err := s.DB.WithContext(c.Request.Context()).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL",
			share.NodeID, share.OwnerID).First(&root).Error; err != nil {
		fail(c, http.StatusGone, "shared preview root unavailable")
		return
	}
	if root.ID != claims.NodeID {
		if root.Type != meta.NodeTypeDir {
			fail(c, http.StatusGone, "shared preview scope changed")
			return
		}
		allowed, err := s.publicFolderShareContainsNode(
			c.Request.Context(), share.OwnerID, root.ID, claims.NodeID)
		if err != nil || !allowed {
			fail(c, http.StatusGone, "shared preview scope changed")
			return
		}
	}
	var node meta.Node
	if err := s.DB.WithContext(c.Request.Context()).Preload("File").
		Where("id = ? AND owner_id = ? AND type = ? AND revision = ? AND deleted_at IS NULL",
			claims.NodeID, share.OwnerID, meta.NodeTypeFile, claims.NodeRevision).
		First(&node).Error; err != nil || node.File == nil {
		fail(c, http.StatusGone, "shared preview source changed")
		return
	}
	mime, err := s.publicSharePreviewMIME(c.Request.Context(), node)
	if err != nil {
		fail(c, http.StatusUnsupportedMediaType, "shared image preview unsupported")
		return
	}
	if !admitPublicSharePreview(share.ID, time.Now(), true) {
		c.Header("Retry-After", "60")
		fail(c, http.StatusTooManyRequests, "shared preview rate limit")
		return
	}
	file, err := s.Store.Open(c.Request.Context(), node.File.StorageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "shared preview content not found")
		return
	}
	defer file.Close()
	c.Header("Content-Type", mime)
	c.Header("Content-Disposition", "inline; filename*=UTF-8''"+url.PathEscape(node.Name))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cross-Origin-Resource-Policy", "same-origin")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("Content-Security-Policy", "default-src 'none'; sandbox")
	c.Header("ETag", fmt.Sprintf("\"shared-preview-%d-%d\"", node.ID, node.Revision))
	http.ServeContent(c.Writer, c.Request, node.Name, node.File.UpdatedAt, file)
}
