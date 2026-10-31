package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	shareUploadMaxActiveSessions = int64(4)
	shareUploadMaxDirectories = int64(2048)
)

var (
	errShareUploadDenied = errors.New("share upload unavailable")
	errShareUploadLimit = errors.New("share upload quota exceeded")
)

// A Guest Share token is NEVER an account JWT. Only these explicit upload
// aliases inject an Owner id for the existing canonical UploadSession writer.
func (s *Server) publicShareUploadAuthorization(c *gin.Context) (meta.Share, meta.Node, bool) {
	share, root, err := s.resolvePublicShare(
		c.Request.Context(), c.GetHeader("X-XDrive-Share-Token"), time.Now(),
	)
	if err != nil {
		writePublicShareLookupError(c, err)
		return meta.Share{}, meta.Node{}, false
	}
	if share.Access != shareAccessViewUpload || root.Type != meta.NodeTypeDir {
		fail(c, http.StatusForbidden, "share upload disabled")
		return meta.Share{}, meta.Node{}, false
	}
	if share.PasswordHash != "" {
		password := c.GetHeader("X-XDrive-Share-Password")
		if password == "" || auth.CheckPassword(share.PasswordHash, password) != nil {
			fail(c, http.StatusUnauthorized, "share_password_invalid")
			return meta.Share{}, meta.Node{}, false
		}
	}
	c.Header("Cache-Control", "private, no-store")
	c.Set("userID", share.OwnerID)
	return share, root, true
}

// Keep the same recursive ancestor boundary as the public read-only folder
// pager, but execute inside the Share/session transaction.
func publicShareUploadContainsNodeTx(
	ctx context.Context, tx *gorm.DB, ownerID, rootID, candidateID uint64,
) (bool, error) {
	var result struct { Allowed bool `gorm:"column:allowed"` }
	err := tx.WithContext(ctx).Raw(`
WITH RECURSIVE ancestors AS (
    SELECT id, parent_id, 0 AS depth
    FROM xd_nodes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
    UNION ALL
    SELECT parent.id, parent.parent_id, child.depth + 1
    FROM xd_nodes parent JOIN ancestors child ON parent.id = child.parent_id
    WHERE parent.owner_id = ? AND parent.deleted_at IS NULL AND child.depth < 128
)
SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = ?) AS allowed
`, candidateID, ownerID, ownerID, rootID).Scan(&result).Error
	return result.Allowed, err
}

// Caller holds Share FOR UPDATE. The active count includes resumable sessions,
// preventing concurrent guests from exceeding the configured link limits.
func (s *Server) publicShareUploadAdmissionTx(
	ctx context.Context, tx *gorm.DB, shareID, ownerID, parentID uint64,
	extraBytes, extraFiles int64, checkQuota bool,
) (meta.Share, error) {
	var share meta.Share
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ?", shareID, ownerID).First(&share).Error; err != nil {
		return share, errShareUploadDenied
	}
	if shareStatus(share, time.Now()) != "active" || share.Access != shareAccessViewUpload ||
		share.MaxUploadBytes <= 0 || share.MaxUploadFiles <= 0 || share.MaxUploadFileBytes <= 0 {
		return share, errShareUploadDenied
	}
	var owner meta.User
	if err := tx.Select("id", "disabled_at").First(&owner, ownerID).Error; err != nil || owner.DisabledAt != nil {
		return share, errShareUploadDenied
	}
	var root, parent meta.Node
	if err := tx.Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
		share.NodeID, ownerID, meta.NodeTypeDir).First(&root).Error; err != nil {
		return share, errShareUploadDenied
	}
	if err := tx.Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
		parentID, ownerID, meta.NodeTypeDir).First(&parent).Error; err != nil {
		return share, errShareUploadDenied
	}
	allowed, err := publicShareUploadContainsNodeTx(ctx, tx, ownerID, root.ID, parent.ID)
	if err != nil || !allowed {
		return share, errShareUploadDenied
	}
	if !checkQuota {
		return share, nil
	}
	if extraBytes < 0 || extraFiles < 0 {
		return share, errShareUploadDenied
	}
	var pending struct {
		Files int64 `gorm:"column:files"`
		Bytes int64 `gorm:"column:bytes"`
	}
	if err := tx.Model(&meta.UploadSession{}).
		Select("COUNT(*) AS files, COALESCE(SUM(total_size), 0) AS bytes").
		Where("share_id = ? AND status = ? AND expires_at > ?",
			shareID, meta.UploadStatusActive, time.Now()).
		Scan(&pending).Error; err != nil {
		return share, err
	}
	if pending.Files > shareUploadMaxActiveSessions ||
		(extraFiles > 0 && pending.Files >= shareUploadMaxActiveSessions) ||
		extraFiles > share.MaxUploadFiles ||
		pending.Files > share.MaxUploadFiles-extraFiles ||
		share.UploadedFiles > share.MaxUploadFiles-extraFiles-pending.Files {
		return share, errShareUploadLimit
	}
	if extraBytes > share.MaxUploadBytes ||
		pending.Bytes > share.MaxUploadBytes-extraBytes ||
		share.UploadedBytes > share.MaxUploadBytes-extraBytes-pending.Bytes {
		return share, errShareUploadLimit
	}
	return share, nil
}

func writePublicShareUploadError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errShareUploadLimit):
		fail(c, http.StatusRequestEntityTooLarge, "share upload quota exceeded")
	case errors.Is(err, errShareUploadDenied):
		fail(c, http.StatusForbidden, "share upload unavailable")
	default:
		fail(c, http.StatusInternalServerError, "share upload failed")
	}
}

// Parent ids are authorization inputs, never arbitrary Owner node grants.
// The only mutation is creating a directory inside the active share subtree.
func (s *Server) publicShareCreateDirectory(c *gin.Context) {
	share, root, ok := s.publicShareUploadAuthorization(c)
	if !ok { return }
	var req struct {
		ParentID uint64 `json:"parent_id"`
		Name string `json:"name"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	if err := c.ShouldBindJSON(&req); err != nil || meta.ValidateName(req.Name) != nil {
		fail(c, http.StatusBadRequest, "invalid directory request")
		return
	}
	if req.ParentID == 0 { req.ParentID = root.ID }
	var result meta.Node
	var created bool
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		current, err := s.publicShareUploadAdmissionTx(
			c.Request.Context(), tx, share.ID, share.OwnerID, req.ParentID, 0, 0, false)
		if err != nil { return err }
		if err := tx.Where(
			"owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
			share.OwnerID, req.ParentID, req.Name,
		).Take(&result).Error; err == nil {
			if result.Type != meta.NodeTypeDir { return errShareUploadDenied }
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) { return err }
		if current.CreatedDirectories >= shareUploadMaxDirectories { return errShareUploadLimit }
		result = meta.Node{
			OwnerID: share.OwnerID, ParentID: &req.ParentID, Name: req.Name,
			Type: meta.NodeTypeDir, Revision: 1,
		}
		if err := tx.Create(&result).Error; err != nil { return err }
		if err := tx.Model(&meta.Share{}).Where("id = ?", share.ID).
			Update("created_directories", gorm.Expr("created_directories + 1")).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil { writePublicShareUploadError(c, err); return }
	status := http.StatusOK
	if created { status = http.StatusCreated }
	c.JSON(status, gin.H{"id": result.ID, "name": result.Name, "parent_id": req.ParentID})
}

func (s *Server) publicShareCreateUpload(c *gin.Context) {
	share, root, ok := s.publicShareUploadAuthorization(c)
	if !ok { return }
	var req uploadInitRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid upload request")
		return
	}
	if req.NodeID != nil || req.ExpectedRevision != 0 || req.MD5 != "" ||
		len(req.ChunkSHA256) != 0 ||
		(req.ConflictPolicy != "" && req.ConflictPolicy != meta.UploadConflictPolicyKeepBoth) ||
		req.Size < 0 || req.Size > share.MaxUploadFileBytes || req.Size > s.MaxUploadBytes ||
		meta.ValidateName(req.Name) != nil {
		fail(c, http.StatusForbidden, "share upload request out of bounds")
		return
	}
	if req.ParentID == nil || *req.ParentID == 0 { req.ParentID = &root.ID }
	allowed, err := s.publicFolderShareContainsNode(
		c.Request.Context(), share.OwnerID, root.ID, *req.ParentID)
	if err != nil || !allowed {
		fail(c, http.StatusForbidden, "share upload destination unavailable")
		return
	}
	req.ConflictPolicy = meta.UploadConflictPolicyKeepBoth
	body, err := json.Marshal(req)
	if err != nil { fail(c, http.StatusBadRequest, "invalid upload request"); return }
	c.Set("xdriveShareUploadID", share.ID)
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	s.createUploadSession(c)
}

// A UUID is a locator, not authority. Every read/write/finalize/abort checks
// the exact ShareID, owner, subtree and current token/password/grant.
func (s *Server) publicShareOwnedUpload(c *gin.Context) bool {
	share, root, ok := s.publicShareUploadAuthorization(c)
	if !ok { return false }
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid upload session id")
		return false
	}
	var session meta.UploadSession
	if err := s.DB.WithContext(c.Request.Context()).
		Where("id = ? AND owner_id = ? AND share_id = ? AND node_id IS NULL",
			id.String(), share.OwnerID, share.ID).First(&session).Error; err != nil {
		fail(c, http.StatusNotFound, "share upload session not found")
		return false
	}
	if session.ParentID == nil || session.TotalSize < 0 ||
		session.TotalSize > share.MaxUploadFileBytes ||
		session.ConflictPolicy != meta.UploadConflictPolicyKeepBoth {
		fail(c, http.StatusForbidden, "share upload session unavailable")
		return false
	}
	allowed, err := s.publicFolderShareContainsNode(
		c.Request.Context(), share.OwnerID, root.ID, *session.ParentID)
	if err != nil || !allowed {
		fail(c, http.StatusForbidden, "share upload destination unavailable")
		return false
	}
	return true
}

func (s *Server) publicShareGetUpload(c *gin.Context) {
	if s.publicShareOwnedUpload(c) { s.getUploadSession(c) }
}

func (s *Server) publicSharePutChunk(c *gin.Context) {
	if !s.publicShareOwnedUpload(c) { return }
	// The underlying PUT retains its exact part size and digest checks.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUploadChunkSize+4096)
	s.putUploadChunk(c)
}

func (s *Server) publicShareFinalizeUpload(c *gin.Context) {
	if !s.publicShareOwnedUpload(c) { return }
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	s.finalizeUploadSession(c)
}

func (s *Server) publicShareAbortUpload(c *gin.Context) {
	if s.publicShareOwnedUpload(c) { s.abortUploadSession(c) }
}
