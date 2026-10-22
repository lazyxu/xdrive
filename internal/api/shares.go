package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errShareUnavailable = errors.New("share unavailable")

type shareDTO struct {
	ID            uint64     `json:"id"`
	NodeID        uint64     `json:"node_id"`
	HasPassword   bool       `json:"has_password"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
	MaxDownloads  int64      `json:"max_downloads"`
	DownloadCount int64      `json:"download_count"`
	RevokedAt     *time.Time `json:"revoked_at,omitempty"`
	Status        string     `json:"status"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type createdShareDTO struct {
	shareDTO
	Token string `json:"token"`
}

// These are the server-authoritative *maximum granted operations*, not
// evidence that a request supplied a valid password or has not been revoked.
// Every actual Share API, derivative, signed ticket, Range and ZIP path must
// continue validating capability, password, expiry, quota and share subtree.
type publicShareCapabilitiesDTO struct {
	List        bool `json:"list"`
	Preview     bool `json:"preview"`
	Download    bool `json:"download"`
	DownloadZIP bool `json:"downloadZip"`
	Search      bool `json:"search"`
	Write       bool `json:"write"`
	Delete      bool `json:"delete"`
}

func publicShareCapabilitiesForNode(nodeType string) publicShareCapabilitiesDTO {
	return publicShareCapabilitiesDTO{
		List: true, Preview: true, Download: true,
		DownloadZIP: nodeType == meta.NodeTypeDir,
		Search:      false, Write: false, Delete: false,
	}
}

type publicShareDTO struct {
	Type             string                     `json:"type"`
	Name             string                     `json:"name"`
	Size             int64                      `json:"size"`
	RequiresPassword bool                       `json:"requires_password"`
	Revision         *uint64                    `json:"revision,omitempty"`
	UpdatedAt        *time.Time                 `json:"updated_at,omitempty"`
	ExpiresAt        *time.Time                 `json:"expires_at,omitempty"`
	MaxDownloads     int64                      `json:"max_downloads"`
	DownloadCount    int64                      `json:"download_count"`
	Capabilities     publicShareCapabilitiesDTO `json:"capabilities"`
}

func toShareDTO(share meta.Share, now time.Time) shareDTO {
	return shareDTO{
		ID:            share.ID,
		NodeID:        share.NodeID,
		HasPassword:   share.PasswordHash != "",
		ExpiresAt:     share.ExpiresAt,
		MaxDownloads:  share.MaxDownloads,
		DownloadCount: share.DownloadCount,
		RevokedAt:     share.RevokedAt,
		Status:        shareStatus(share, now),
		CreatedAt:     share.CreatedAt,
		UpdatedAt:     share.UpdatedAt,
	}
}

func shareStatus(share meta.Share, now time.Time) string {
	switch {
	case share.RevokedAt != nil:
		return "revoked"
	case share.ExpiresAt != nil && !now.Before(*share.ExpiresAt):
		return "expired"
	case share.MaxDownloads > 0 && share.DownloadCount >= share.MaxDownloads:
		return "exhausted"
	default:
		return "active"
	}
}

func generateShareToken() (raw, hash string, err error) {
	var token [32]byte
	if _, err = rand.Read(token[:]); err != nil {
		return "", "", err
	}
	raw = base64.RawURLEncoding.EncodeToString(token[:])
	sum := sha256.Sum256([]byte(raw))
	return raw, hex.EncodeToString(sum[:]), nil
}

func hashShareToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func (s *Server) createFileShare(c *gin.Context) {
	nodeID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid file id")
		return
	}
	node, err := s.ownedNode(userID(c), nodeID, true)
	if err != nil || (node.Type != meta.NodeTypeFile && node.Type != meta.NodeTypeDir) ||
		(node.Type == meta.NodeTypeFile && node.File == nil) ||
		(node.Type == meta.NodeTypeDir && node.ParentID == nil) {
		fail(c, http.StatusNotFound, "file not found")
		return
	}

	var req struct {
		ExpiresAt    *time.Time `json:"expires_at"`
		Password     string     `json:"password"`
		MaxDownloads int64      `json:"max_downloads"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	now := time.Now()
	if req.ExpiresAt != nil && !req.ExpiresAt.After(now) {
		fail(c, http.StatusBadRequest, "expires_at must be in the future")
		return
	}
	if req.MaxDownloads < 0 {
		fail(c, http.StatusBadRequest, "max_downloads must be zero or greater")
		return
	}

	passwordHash := ""
	if req.Password != "" {
		passwordHash, err = auth.HashPassword(req.Password)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
	}

	rawToken, tokenHash, err := generateShareToken()
	if err != nil {
		fail(c, http.StatusInternalServerError, "share token generation failed")
		return
	}
	share := meta.Share{
		OwnerID:       userID(c),
		NodeID:        node.ID,
		TokenHash:     tokenHash,
		PasswordHash:  passwordHash,
		ExpiresAt:     req.ExpiresAt,
		MaxDownloads:  req.MaxDownloads,
		DownloadCount: 0,
	}
	if err := s.DB.Create(&share).Error; err != nil {
		fail(c, http.StatusInternalServerError, "create share failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusCreated, createdShareDTO{shareDTO: toShareDTO(share, now), Token: rawToken})
}

func (s *Server) listFileShares(c *gin.Context) {
	nodeID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid file id")
		return
	}
	node, err := s.ownedNode(userID(c), nodeID, true)
	if err != nil || (node.Type != meta.NodeTypeFile && node.Type != meta.NodeTypeDir) ||
		(node.Type == meta.NodeTypeFile && node.File == nil) ||
		(node.Type == meta.NodeTypeDir && node.ParentID == nil) {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	var shares []meta.Share
	if err := s.DB.Where("owner_id = ? AND node_id = ?", userID(c), nodeID).
		Order("created_at DESC, id DESC").Find(&shares).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list shares failed")
		return
	}
	now := time.Now()
	out := make([]shareDTO, 0, len(shares))
	for _, share := range shares {
		out = append(out, toShareDTO(share, now))
	}
	c.JSON(http.StatusOK, out)
}

func (s *Server) revokeShare(c *gin.Context) {
	shareID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid share id")
		return
	}
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var share meta.Share
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", shareID, userID(c)).First(&share).Error; err != nil {
			return err
		}
		if share.RevokedAt != nil {
			return nil
		}
		now := time.Now()
		return tx.Model(&meta.Share{}).Where("id = ?", share.ID).Update("revoked_at", &now).Error
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "share not found")
		} else {
			fail(c, http.StatusInternalServerError, "revoke share failed")
		}
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) publicShareMetadata(c *gin.Context) {
	rawToken := strings.TrimSpace(c.GetHeader("X-XDrive-Share-Token"))
	share, node, err := s.resolvePublicShare(c.Request.Context(), rawToken, time.Now())
	if err != nil {
		writePublicShareLookupError(c, err)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	var size int64
	if node.File != nil {
		size = node.File.Size
	}
	// Public metadata is visible with possession of the capability token alone.
	// A password-protected share must not reveal NEW revision/timestamp metadata
	// before its separate password-checked child/preview/download request.
	var revision *uint64
	var updatedAt *time.Time
	if share.PasswordHash == "" {
		revision = &node.Revision
		updatedAt = &node.UpdatedAt
	}
	c.JSON(http.StatusOK, publicShareDTO{
		Type:             node.Type,
		Name:             node.Name,
		Size:             size,
		Revision:         revision,
		UpdatedAt:        updatedAt,
		RequiresPassword: share.PasswordHash != "",
		ExpiresAt:        share.ExpiresAt,
		MaxDownloads:     share.MaxDownloads,
		DownloadCount:    share.DownloadCount,
		Capabilities:     publicShareCapabilitiesForNode(node.Type),
	})
}

func (s *Server) publicShareDownload(c *gin.Context) {
	rawToken := strings.TrimSpace(c.GetHeader("X-XDrive-Share-Token"))
	share, node, err := s.resolvePublicShare(c.Request.Context(), rawToken, time.Now())
	if err != nil {
		writePublicShareLookupError(c, err)
		return
	}

	if node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusBadRequest, "folder share requires a file download ticket")
		return
	}

	var req struct {
		Password string `json:"password"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if share.PasswordHash != "" {
		if req.Password == "" || auth.CheckPassword(share.PasswordHash, req.Password) != nil {
			fail(c, http.StatusUnauthorized, "share_password_invalid")
			return
		}
	}

	file, err := s.Store.Open(c.Request.Context(), node.File.StorageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "stored content not found")
		return
	}
	defer file.Close()

	now := time.Now()
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var current meta.Share
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND token_hash = ?", share.ID, hashShareToken(rawToken)).
			First(&current).Error; err != nil {
			return err
		}
		if shareStatus(current, now) != "active" {
			return errShareUnavailable
		}

		var owner meta.User
		if err := tx.Select("id", "disabled_at").First(&owner, current.OwnerID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errShareUnavailable
			}
			return err
		}
		if owner.DisabledAt != nil {
			return errShareUnavailable
		}
		var activeNode meta.Node
		if err := tx.Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			current.NodeID, current.OwnerID, meta.NodeTypeFile).First(&activeNode).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errShareUnavailable
			}
			return err
		}
		return tx.Model(&meta.Share{}).Where("id = ?", current.ID).
			Update("download_count", gorm.Expr("download_count + 1")).Error
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "share_not_found")
		} else if errors.Is(err, errShareUnavailable) {
			fail(c, http.StatusGone, "share_unavailable")
		} else {
			fail(c, http.StatusInternalServerError, "share download failed")
		}
		return
	}

	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(node.Name))
	c.Header("ETag", fmt.Sprintf("\"%d\"", node.Revision))
	if node.File.SHA256 != "" {
		c.Header("X-Content-SHA256", node.File.SHA256)
	}
	http.ServeContent(c.Writer, c.Request, node.Name, node.File.UpdatedAt, file)
}

const publicShareDownloadTicketTTL = 5 * time.Minute

type publicShareDownloadTicketDTO struct {
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (s *Server) publicShareDownloadTicket(c *gin.Context) {
	rawToken := strings.TrimSpace(c.GetHeader("X-XDrive-Share-Token"))
	share, node, err := s.resolvePublicShare(c.Request.Context(), rawToken, time.Now())
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
	if share.PasswordHash != "" {
		if req.Password == "" || auth.CheckPassword(share.PasswordHash, req.Password) != nil {
			fail(c, http.StatusUnauthorized, "share_password_invalid")
			return
		}
	}

	target := node
	if node.Type == meta.NodeTypeDir {
		if req.NodeID == 0 {
			fail(c, http.StatusBadRequest, "node_id required for folder shares")
			return
		}
		allowed, checkErr := s.publicFolderShareContainsNode(c.Request.Context(), share.OwnerID, node.ID, req.NodeID)
		if checkErr != nil {
			fail(c, http.StatusInternalServerError, "share scope lookup failed")
			return
		}
		if !allowed {
			fail(c, http.StatusNotFound, "shared file not found")
			return
		}
		// GORM uses a nonzero destination primary key as an implicit WHERE.
		// Reusing the folder Node would add AND id = <share-root-id> here,
		// incorrectly rejecting every legitimate descendant file.
		target = meta.Node{}
		if checkErr = s.DB.WithContext(c.Request.Context()).Preload("File").
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				req.NodeID, share.OwnerID, meta.NodeTypeFile).First(&target).Error; checkErr != nil || target.File == nil {
			fail(c, http.StatusNotFound, "shared file not found")
			return
		}
	}

	now := time.Now()
	var ticket string
	var expiresAt time.Time
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var current meta.Share
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND token_hash = ?", share.ID, hashShareToken(rawToken)).
			First(&current).Error; err != nil {
			return err
		}
		if shareStatus(current, now) != "active" {
			return errShareUnavailable
		}

		var owner meta.User
		if err := tx.Select("id", "disabled_at").First(&owner, current.OwnerID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errShareUnavailable
			}
			return err
		}
		if owner.DisabledAt != nil {
			return errShareUnavailable
		}

		var activeRoot meta.Node
		if err := tx.Select("id").
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				current.NodeID, current.OwnerID, node.Type).
			First(&activeRoot).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errShareUnavailable
			}
			return err
		}
		var activeNode meta.Node
		if err := tx.Where(
			"id = ? AND owner_id = ? AND type = ? AND revision = ? AND deleted_at IS NULL",
			target.ID,
			current.OwnerID,
			meta.NodeTypeFile,
			target.Revision,
		).First(&activeNode).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errShareUnavailable
			}
			return err
		}

		ticket, expiresAt, err = s.Auth.IssuePublicShareDownload(
			current.ID,
			activeNode.ID,
			activeNode.Revision,
			publicShareDownloadTicketTTL,
		)
		if err != nil {
			return err
		}
		result := tx.Model(&meta.Share{}).
			Where("id = ? AND download_count = ?", current.ID, current.DownloadCount).
			Update("download_count", gorm.Expr("download_count + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errShareUnavailable
		}
		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "share_not_found")
		case errors.Is(err, errShareUnavailable):
			fail(c, http.StatusGone, "share_unavailable")
		default:
			fail(c, http.StatusInternalServerError, "create public share download ticket failed")
		}
		return
	}

	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, publicShareDownloadTicketDTO{
		URL: fmt.Sprintf(
			"/api/v1/public-share-download/%d?ticket=%s",
			share.ID,
			url.QueryEscape(ticket),
		),
		ExpiresAt: expiresAt.UTC(),
	})
}

func (s *Server) publicShareDownloadTicketStream(c *gin.Context) {
	shareID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid share id")
		return
	}
	claims, err := s.Auth.ParsePublicShareDownload(strings.TrimSpace(c.Query("ticket")))
	if err != nil || claims.ShareID != shareID {
		fail(c, http.StatusUnauthorized, "invalid public share download ticket")
		return
	}

	var share meta.Share
	if err := s.DB.WithContext(c.Request.Context()).First(&share, shareID).Error; err != nil {
		writePublicShareLookupError(c, err)
		return
	}
	now := time.Now()
	if share.RevokedAt != nil ||
		(share.ExpiresAt != nil && !now.Before(*share.ExpiresAt)) {
		fail(c, http.StatusGone, "share_download_ticket_stale")
		return
	}

	var owner meta.User
	if err := s.DB.WithContext(c.Request.Context()).
		Select("id", "disabled_at").
		First(&owner, share.OwnerID).Error; err != nil || owner.DisabledAt != nil {
		fail(c, http.StatusGone, "share_download_ticket_stale")
		return
	}

	if share.NodeID != claims.NodeID {
		var root meta.Node
		if err := s.DB.WithContext(c.Request.Context()).
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				share.NodeID, share.OwnerID, meta.NodeTypeDir).
			First(&root).Error; err != nil {
			fail(c, http.StatusGone, "share_download_ticket_stale")
			return
		}
		allowed, err := s.publicFolderShareContainsNode(c.Request.Context(), share.OwnerID, root.ID, claims.NodeID)
		if err != nil || !allowed {
			fail(c, http.StatusGone, "share_download_ticket_stale")
			return
		}
	}

	var node meta.Node
	if err := s.DB.WithContext(c.Request.Context()).Preload("File").
		Where(
			"id = ? AND owner_id = ? AND type = ? AND revision = ? AND deleted_at IS NULL",
			claims.NodeID,
			share.OwnerID,
			meta.NodeTypeFile,
			claims.NodeRevision,
		).
		First(&node).Error; err != nil || node.File == nil {
		fail(c, http.StatusGone, "share_download_ticket_stale")
		return
	}
	file, err := s.Store.Open(c.Request.Context(), node.File.StorageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "stored content not found")
		return
	}
	defer file.Close()

	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(node.Name))
	c.Header("ETag", fmt.Sprintf("\"%d\"", node.Revision))
	if node.File.SHA256 != "" {
		c.Header("X-Content-SHA256", node.File.SHA256)
	}
	http.ServeContent(
		c.Writer,
		c.Request,
		node.Name,
		node.File.UpdatedAt,
		file,
	)
}

func (s *Server) resolvePublicShare(ctx context.Context, rawToken string, now time.Time) (meta.Share, meta.Node, error) {
	rawToken = strings.TrimSpace(rawToken)
	if rawToken == "" {
		return meta.Share{}, meta.Node{}, gorm.ErrRecordNotFound
	}
	var share meta.Share
	if err := s.DB.WithContext(ctx).Where("token_hash = ?", hashShareToken(rawToken)).First(&share).Error; err != nil {
		return meta.Share{}, meta.Node{}, err
	}
	if shareStatus(share, now) != "active" {
		return meta.Share{}, meta.Node{}, errShareUnavailable
	}
	var owner meta.User
	if err := s.DB.WithContext(ctx).Select("id", "disabled_at").First(&owner, share.OwnerID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return meta.Share{}, meta.Node{}, errShareUnavailable
		}
		return meta.Share{}, meta.Node{}, err
	}
	if owner.DisabledAt != nil {
		return meta.Share{}, meta.Node{}, errShareUnavailable
	}
	var node meta.Node
	if err := s.DB.WithContext(ctx).Preload("File").
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", share.NodeID, share.OwnerID).
		First(&node).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return meta.Share{}, meta.Node{}, errShareUnavailable
		}
		return meta.Share{}, meta.Node{}, err
	}
	if (node.Type == meta.NodeTypeFile && node.File == nil) ||
		(node.Type != meta.NodeTypeFile && node.Type != meta.NodeTypeDir) {
		return meta.Share{}, meta.Node{}, errShareUnavailable
	}
	return share, node, nil
}

func writePublicShareLookupError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		fail(c, http.StatusNotFound, "share_not_found")
	case errors.Is(err, errShareUnavailable):
		fail(c, http.StatusGone, "share_unavailable")
	default:
		fail(c, http.StatusInternalServerError, "share lookup failed")
	}
}
