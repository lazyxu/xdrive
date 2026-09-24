package api

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type fileVersionDTO struct {
	ID        uint64    `json:"id"`
	NodeID    uint64    `json:"node_id"`
	Revision  uint64    `json:"revision"`
	Size      int64     `json:"size"`
	SHA256    string    `json:"sha256,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func toFileVersionDTO(v meta.FileVersion) fileVersionDTO {
	return fileVersionDTO{
		ID: v.ID, NodeID: v.NodeID, Revision: v.Revision, Size: v.Size, SHA256: v.SHA256, CreatedAt: v.CreatedAt,
	}
}

func (s *Server) trashList(c *gin.Context) {
	var nodes []meta.Node
	if err := s.DB.Preload("File").
		Where("owner_id = ? AND deleted_at IS NOT NULL AND trash_root_id = id", userID(c)).
		Order("deleted_at DESC, id DESC").
		Find(&nodes).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list trash failed")
		return
	}
	out := make([]nodeDTO, 0, len(nodes))
	for _, n := range nodes {
		out = append(out, toNodeDTO(n))
	}
	c.JSON(http.StatusOK, out)
}

func (s *Server) trashRestore(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid trash id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}

	var currentRevision uint64
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var root meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NOT NULL AND trash_root_id = ?", id, userID(c), id).
			First(&root).Error; err != nil {
			return err
		}
		currentRevision = root.Revision
		if root.Revision != expected {
			return errRevisionConflict
		}
		if root.ParentID == nil {
			return errRootMutation
		}
		var parent meta.Node
		if err := tx.Where("id = ? AND owner_id = ? AND deleted_at IS NULL", *root.ParentID, userID(c)).
			First(&parent).Error; err != nil {
			return errTrashParentUnavailable
		}
		var count int64
		if err := tx.Model(&meta.Node{}).
			Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)",
				userID(c), *root.ParentID, root.Name).
			Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return errTrashNameConflict
		}
		if err := tx.Model(&meta.Node{}).
			Where("owner_id = ? AND trash_root_id = ?", userID(c), id).
			Updates(map[string]any{"deleted_at": nil, "trash_root_id": nil}).Error; err != nil {
			return err
		}
		now := time.Now()
		return tx.Model(&meta.Node{}).Where("id = ? AND owner_id = ?", id, userID(c)).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now}).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, errTrashParentUnavailable):
			fail(c, http.StatusConflict, "original parent is unavailable or still in trash")
		case errors.Is(err, errTrashNameConflict), isDuplicate(err):
			fail(c, http.StatusConflict, "name already exists")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "trash item not found")
		default:
			fail(c, http.StatusInternalServerError, "restore failed")
		}
		return
	}
	n, err := s.ownedNode(userID(c), id, true)
	if err != nil {
		fail(c, http.StatusInternalServerError, "restored item reload failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("\"%d\"", n.Revision))
	c.JSON(http.StatusOK, toNodeDTO(n))
}

func (s *Server) trashDeletePermanently(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid trash id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}

	var currentRevision uint64
	var files []meta.File
	var versions []meta.FileVersion
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var root meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NOT NULL AND trash_root_id = ?", id, userID(c), id).
			First(&root).Error; err != nil {
			return err
		}
		currentRevision = root.Revision
		if root.Revision != expected {
			return errRevisionConflict
		}
		ids, err := subtreeIDsDB(tx, userID(c), id)
		if err != nil {
			return err
		}
		if err := tx.Where("node_id IN ?", ids).Find(&versions).Error; err != nil {
			return err
		}
		if err := tx.Where("node_id IN ?", ids).Find(&files).Error; err != nil {
			return err
		}
		if err := tx.Where("node_id IN ?", ids).Delete(&meta.Share{}).Error; err != nil {
			return err
		}
		if err := tx.Where("node_id IN ?", ids).Delete(&meta.FileVersion{}).Error; err != nil {
			return err
		}
		if err := tx.Where("node_id IN ?", ids).Delete(&meta.File{}).Error; err != nil {
			return err
		}
		return tx.Where("id IN ? AND owner_id = ?", ids, userID(c)).Delete(&meta.Node{}).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "trash item not found")
		default:
			fail(c, http.StatusInternalServerError, "permanent delete failed")
		}
		return
	}
	for _, f := range files {
		_ = s.Store.Delete(c.Request.Context(), f.StorageKey)
	}
	for _, v := range versions {
		_ = s.Store.Delete(c.Request.Context(), v.StorageKey)
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) fileVersions(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid file id")
		return
	}
	n, err := s.ownedNode(userID(c), id, true)
	if err != nil || n.Type != meta.NodeTypeFile || n.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	var versions []meta.FileVersion
	if err := s.DB.Where("node_id = ?", id).Order("revision DESC, id DESC").Find(&versions).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list versions failed")
		return
	}
	out := make([]fileVersionDTO, 0, len(versions))
	for _, v := range versions {
		out = append(out, toFileVersionDTO(v))
	}
	c.JSON(http.StatusOK, out)
}

func (s *Server) downloadFileVersion(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid file id")
		return
	}
	versionID, ok := parseID(c.Param("versionID"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid version id")
		return
	}
	n, err := s.ownedNode(userID(c), id, false)
	if err != nil || n.Type != meta.NodeTypeFile {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	var version meta.FileVersion
	if err := s.DB.Where("id = ? AND node_id = ?", versionID, id).First(&version).Error; err != nil {
		fail(c, http.StatusNotFound, "version not found")
		return
	}
	f, err := s.Store.Open(c.Request.Context(), version.StorageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "stored version not found")
		return
	}
	defer f.Close()
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(n.Name))
	if version.SHA256 != "" {
		c.Header("X-Content-SHA256", version.SHA256)
	}
	http.ServeContent(c.Writer, c.Request, n.Name, version.CreatedAt, f)
}

func (s *Server) restoreFileVersion(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid file id")
		return
	}
	versionID, ok := parseID(c.Param("versionID"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid version id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}

	var currentRevision uint64
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var current meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", id, userID(c)).
			First(&current).Error; err != nil {
			return err
		}
		currentRevision = current.Revision
		if current.Revision != expected {
			return errRevisionConflict
		}
		if current.Type != meta.NodeTypeFile {
			return gorm.ErrRecordNotFound
		}
		var selected meta.FileVersion
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND node_id = ?", versionID, id).First(&selected).Error; err != nil {
			return err
		}
		var file meta.File
		if err := tx.Where("node_id = ?", id).First(&file).Error; err != nil {
			return err
		}
		now := time.Now()
		if err := tx.Create(&meta.FileVersion{
			NodeID: id, Revision: current.Revision, Size: file.Size, StorageKey: file.StorageKey, SHA256: file.SHA256, CreatedAt: now,
		}).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.File{}).Where("node_id = ?", id).Updates(map[string]any{
			"size": selected.Size, "storage_key": selected.StorageKey, "sha256": selected.SHA256, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&meta.FileVersion{}, selected.ID).Error; err != nil {
			return err
		}
		return tx.Model(&meta.Node{}).
			Where("id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL", id, userID(c), expected).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now}).Error
	})
	if err != nil {
		if errors.Is(err, errRevisionConflict) {
			revisionConflict(c, expected, currentRevision)
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "file or version not found")
		} else {
			fail(c, http.StatusInternalServerError, "restore version failed")
		}
		return
	}
	n, err := s.ownedNode(userID(c), id, true)
	if err != nil {
		fail(c, http.StatusInternalServerError, "file reload failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("\"%d\"", n.Revision))
	c.JSON(http.StatusOK, toNodeDTO(n))
}

func activeSubtreeIDsDB(db *gorm.DB, uid, root uint64) ([]uint64, error) {
	type row struct{ ID uint64 }
	var rows []row
	err := db.Raw(`WITH RECURSIVE tree AS (
SELECT id FROM xd_nodes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
UNION ALL
SELECT n.id FROM xd_nodes n JOIN tree t ON n.parent_id = t.id
WHERE n.owner_id = ? AND n.deleted_at IS NULL
) SELECT id FROM tree`, root, uid, uid).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	ids := make([]uint64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	if len(ids) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return ids, nil
}

var (
	errTrashParentUnavailable = errors.New("trash parent unavailable")
	errTrashNameConflict      = errors.New("trash name conflict")
)
