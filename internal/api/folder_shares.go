package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

const publicFolderSharePageLimit = 100

type publicFolderShareItem struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
	Size int64  `json:"size"`
}

type publicFolderSharePage struct {
	ParentID   uint64                  `json:"parent_id"`
	Items      []publicFolderShareItem `json:"items"`
	NextCursor uint64                  `json:"next_cursor"`
}

// An ancestor walk, not a display-name/path-prefix match. In particular a
// moved-out or trashed child cannot retain authority from a folder link.
// PostgreSQL bounds this read to 129 ancestors even on malformed graphs.
func (s *Server) publicFolderShareContainsNode(
	ctx context.Context, ownerID, rootID, candidateID uint64,
) (bool, error) {
	var result struct {
		Allowed bool `gorm:"column:allowed"`
	}
	err := s.DB.WithContext(ctx).Raw(`
WITH RECURSIVE ancestors AS (
    SELECT id, parent_id, 0 AS depth
    FROM xd_nodes
    WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
    UNION ALL
    SELECT parent.id, parent.parent_id, child.depth + 1
    FROM xd_nodes AS parent
    JOIN ancestors AS child ON parent.id = child.parent_id
    WHERE parent.owner_id = ? AND parent.deleted_at IS NULL AND child.depth < 128
)
SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = ?) AS allowed
`, candidateID, ownerID, ownerID, rootID).Scan(&result).Error
	return result.Allowed, err
}

// A capability link allows only bounded read-only navigation. It never
// enumerates the whole subtree, generates an archive or grants upload rights.
func (s *Server) publicFolderShareChildren(c *gin.Context) {
	rawToken := c.GetHeader("X-XDrive-Share-Token")
	share, root, err := s.resolvePublicShare(c.Request.Context(), rawToken, time.Now())
	if err != nil {
		writePublicShareLookupError(c, err)
		return
	}
	if root.Type != meta.NodeTypeDir {
		fail(c, http.StatusBadRequest, "not a folder share")
		return
	}
	var req struct {
		Password string `json:"password"`
		ParentID uint64 `json:"parent_id"`
		Cursor   uint64 `json:"cursor"`
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
	parentID := req.ParentID
	if parentID == 0 {
		parentID = root.ID
	}
	allowed, err := s.publicFolderShareContainsNode(c.Request.Context(), share.OwnerID, root.ID, parentID)
	if err != nil {
		fail(c, http.StatusInternalServerError, "folder scope lookup failed")
		return
	}
	if !allowed {
		fail(c, http.StatusNotFound, "shared folder not found")
		return
	}
	var parent meta.Node
	if err := s.DB.WithContext(c.Request.Context()).Select("id").
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			parentID, share.OwnerID, meta.NodeTypeDir).
		First(&parent).Error; err != nil {
		fail(c, http.StatusNotFound, "shared folder not found")
		return
	}
	var children []meta.Node
	if err := s.DB.WithContext(c.Request.Context()).Preload("File").
		Where("parent_id = ? AND owner_id = ? AND id > ? AND deleted_at IS NULL",
			parent.ID, share.OwnerID, req.Cursor).
		Order("id ASC").Limit(publicFolderSharePageLimit + 1).
		Find(&children).Error; err != nil {
		fail(c, http.StatusInternalServerError, "shared folder page failed")
		return
	}
	page := publicFolderSharePage{
		ParentID: parentID,
		Items:    make([]publicFolderShareItem, 0, publicFolderSharePageLimit),
	}
	if len(children) > publicFolderSharePageLimit {
		children = children[:publicFolderSharePageLimit]
		page.NextCursor = children[len(children)-1].ID
	}
	for _, item := range children {
		if item.Type != meta.NodeTypeDir && item.Type != meta.NodeTypeFile {
			continue
		}
		entry := publicFolderShareItem{ID: item.ID, Name: item.Name, Type: item.Type}
		if item.Type == meta.NodeTypeFile && item.File != nil {
			entry.Size = item.File.Size
		}
		page.Items = append(page.Items, entry)
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, page)
}
