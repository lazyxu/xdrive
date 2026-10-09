package api

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errMediaAlbumFolderDuplicate = errors.New("album folder name already exists in parent")
	errMediaAlbumFolderNotEmpty  = errors.New("album folder contains albums or subfolders")
	errMediaAlbumFolderParent    = errors.New("album folder parent not found")
	errMediaAlbumFolderCycle     = errors.New("album folder cycle or excessive depth")
)

const mediaAlbumFolderMaximumDepth = 64
const mediaAlbumFolderMaximumList = 5000

type mediaAlbumFolderDTO struct {
	ID        uint64    `json:"id"`
	ParentID  uint64    `json:"parent_id"`
	Name      string    `json:"name"`
	Revision  uint64    `json:"revision"`
	UpdatedAt time.Time `json:"updated_at"`
}

func mediaAlbumFolderDTOFor(row meta.PhotoAlbumFolder) mediaAlbumFolderDTO {
	return mediaAlbumFolderDTO{
		ID: row.ID, ParentID: row.ParentID, Name: row.Name,
		Revision: row.Revision, UpdatedAt: row.UpdatedAt,
	}
}

func mediaAlbumFolderParam(c *gin.Context) (uint64, bool) {
	raw := strings.TrimSpace(c.Param("folderID"))
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || id == 0 || id > (1<<53)-1 {
		fail(c, http.StatusBadRequest, "folderID must be a positive safe integer")
		return 0, false
	}
	return id, true
}

// Serializing folder writes on the owner row makes sibling-name uniqueness,
// ancestor checks, and empty-folder deletion resistant to concurrent moves.
func lockMediaAlbumFolderOwner(tx *gorm.DB, ownerID uint64) error {
	var owner meta.User
	return tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id").Where("id = ?", ownerID).Take(&owner).Error
}

func validMediaAlbumFolderParent(tx *gorm.DB, ownerID, parentID, movingFolderID uint64) error {
	seen := map[uint64]bool{}
	for depth := 0; parentID != 0; depth++ {
		if depth >= mediaAlbumFolderMaximumDepth || parentID == movingFolderID || seen[parentID] {
			return errMediaAlbumFolderCycle
		}
		seen[parentID] = true
		var parent meta.PhotoAlbumFolder
		if err := tx.Select("id, parent_id").
			Where("owner_id = ? AND id = ?", ownerID, parentID).
			Take(&parent).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errMediaAlbumFolderParent
			}
			return err
		}
		parentID = parent.ParentID
	}
	return nil
}

func uniqueMediaAlbumFolderSibling(tx *gorm.DB, ownerID, parentID, excludeID uint64, nameKey string) error {
	query := tx.Model(&meta.PhotoAlbumFolder{}).
		Where("owner_id = ? AND parent_id = ? AND name_key = ?", ownerID, parentID, nameKey)
	if excludeID > 0 {
		query = query.Where("id <> ?", excludeID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return errMediaAlbumFolderDuplicate
	}
	return nil
}

func respondMediaAlbumFolderError(c *gin.Context, err error, expected, current uint64) {
	switch {
	case errors.Is(err, errRevisionConflict):
		revisionConflict(c, expected, current)
	case errors.Is(err, gorm.ErrRecordNotFound), errors.Is(err, errMediaAlbumFolderParent):
		fail(c, http.StatusNotFound, "album folder not found")
	case errors.Is(err, errMediaAlbumFolderDuplicate), errors.Is(err, errMediaAlbumFolderCycle),
		errors.Is(err, errMediaAlbumFolderNotEmpty):
		fail(c, http.StatusConflict, err.Error())
	default:
		fail(c, http.StatusInternalServerError, "album folder operation failed")
	}
}

func (s *Server) listMediaAlbumFolders(c *gin.Context) {
	var rows []meta.PhotoAlbumFolder
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ?", userID(c)).
		Order("parent_id ASC, name_key ASC, id ASC").
		Limit(mediaAlbumFolderMaximumList + 1).
		Find(&rows).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list album folders failed")
		return
	}
	if len(rows) > mediaAlbumFolderMaximumList {
		fail(c, http.StatusConflict, "too many album folders for this list endpoint")
		return
	}
	items := make([]mediaAlbumFolderDTO, 0, len(rows))
	for _, row := range rows {
		items = append(items, mediaAlbumFolderDTOFor(row))
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, items)
}

func (s *Server) createMediaAlbumFolder(c *gin.Context) {
	var input struct {
		Name     string `json:"name"`
		ParentID uint64 `json:"parent_id"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid album folder request")
		return
	}
	name, err := normalizeMediaAlbumName(input.Name)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	if input.ParentID > (1<<53)-1 {
		fail(c, http.StatusBadRequest, "parent_id is not a safe integer")
		return
	}
	now := time.Now().UTC()
	folder := meta.PhotoAlbumFolder{
		OwnerID: userID(c), ParentID: input.ParentID,
		Name: name, NameKey: strings.ToLower(name), Revision: 1,
		CreatedAt: now, UpdatedAt: now,
	}
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := lockMediaAlbumFolderOwner(tx, userID(c)); err != nil {
			return err
		}
		if err := validMediaAlbumFolderParent(tx, userID(c), input.ParentID, 0); err != nil {
			return err
		}
		if err := uniqueMediaAlbumFolderSibling(tx, userID(c), input.ParentID, 0, folder.NameKey); err != nil {
			return err
		}
		return tx.Create(&folder).Error
	})
	if err != nil {
		respondMediaAlbumFolderError(c, err, 0, 0)
		return
	}
	c.Header("ETag", fmt.Sprintf("%q", strconv.FormatUint(folder.Revision, 10)))
	c.JSON(http.StatusCreated, mediaAlbumFolderDTOFor(folder))
}

func (s *Server) updateMediaAlbumFolder(c *gin.Context) {
	id, ok := mediaAlbumFolderParam(c)
	if !ok {
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	var input struct {
		Name     *string `json:"name"`
		ParentID *uint64 `json:"parent_id"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || (input.Name == nil && input.ParentID == nil) {
		fail(c, http.StatusBadRequest, "name or parent_id is required")
		return
	}
	var name string
	if input.Name != nil {
		var err error
		name, err = normalizeMediaAlbumName(*input.Name)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	if input.ParentID != nil && *input.ParentID > (1<<53)-1 {
		fail(c, http.StatusBadRequest, "parent_id is not a safe integer")
		return
	}
	var currentRevision uint64
	var folder meta.PhotoAlbumFolder
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := lockMediaAlbumFolderOwner(tx, userID(c)); err != nil {
			return err
		}
		if err := tx.Where("owner_id = ? AND id = ?", userID(c), id).Take(&folder).Error; err != nil {
			return err
		}
		currentRevision = folder.Revision
		if currentRevision != expected {
			return errRevisionConflict
		}
		nextParent := folder.ParentID
		if input.ParentID != nil {
			nextParent = *input.ParentID
		}
		nextName := folder.Name
		if input.Name != nil {
			nextName = name
		}
		nextKey := strings.ToLower(nextName)
		if err := validMediaAlbumFolderParent(tx, userID(c), nextParent, id); err != nil {
			return err
		}
		if err := uniqueMediaAlbumFolderSibling(tx, userID(c), nextParent, id, nextKey); err != nil {
			return err
		}
		if folder.ParentID == nextParent && folder.Name == nextName {
			return nil
		}
		result := tx.Model(&meta.PhotoAlbumFolder{}).
			Where("owner_id = ? AND id = ? AND revision = ?", userID(c), id, expected).
			Updates(map[string]any{
				"parent_id": nextParent, "name": nextName, "name_key": nextKey,
				"revision": gorm.Expr("revision + 1"), "updated_at": time.Now().UTC(),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errRevisionConflict
		}
		return tx.Where("owner_id = ? AND id = ?", userID(c), id).Take(&folder).Error
	})
	if err != nil {
		respondMediaAlbumFolderError(c, err, expected, currentRevision)
		return
	}
	c.Header("ETag", fmt.Sprintf("%q", strconv.FormatUint(folder.Revision, 10)))
	c.JSON(http.StatusOK, mediaAlbumFolderDTOFor(folder))
}

func (s *Server) deleteMediaAlbumFolder(c *gin.Context) {
	id, ok := mediaAlbumFolderParam(c)
	if !ok {
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	var currentRevision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := lockMediaAlbumFolderOwner(tx, userID(c)); err != nil {
			return err
		}
		var folder meta.PhotoAlbumFolder
		if err := tx.Where("owner_id = ? AND id = ?", userID(c), id).Take(&folder).Error; err != nil {
			return err
		}
		currentRevision = folder.Revision
		if expected != currentRevision {
			return errRevisionConflict
		}
		var subfolderCount, albumCount int64
		if err := tx.Model(&meta.PhotoAlbumFolder{}).
			Where("owner_id = ? AND parent_id = ?", userID(c), id).Count(&subfolderCount).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.PhotoCollection{}).
			Where("owner_id = ? AND album_folder_id = ?", userID(c), id).Count(&albumCount).Error; err != nil {
			return err
		}
		if subfolderCount > 0 || albumCount > 0 {
			return errMediaAlbumFolderNotEmpty
		}
		result := tx.Where("owner_id = ? AND id = ? AND revision = ?", userID(c), id, expected).
			Delete(&meta.PhotoAlbumFolder{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errRevisionConflict
		}
		return nil
	})
	if err != nil {
		respondMediaAlbumFolderError(c, err, expected, currentRevision)
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) moveMediaAlbumToFolder(c *gin.Context) {
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	key := strings.TrimSpace(c.Param("albumID"))
	if !strings.HasPrefix(key, "manual:") && !strings.HasPrefix(key, "smart:") {
		fail(c, http.StatusConflict, "only local manual/smart albums support album folders")
		return
	}
	var input struct {
		FolderID *uint64 `json:"folder_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.FolderID == nil {
		fail(c, http.StatusBadRequest, "folder_id is required (0 means root)")
		return
	}
	if *input.FolderID > (1<<53)-1 {
		fail(c, http.StatusBadRequest, "folder_id is not a safe integer")
		return
	}
	var currentRevision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := lockMediaAlbumFolderOwner(tx, userID(c)); err != nil {
			return err
		}
		var album meta.PhotoCollection
		if err := tx.Where(
			"owner_id = ? AND external_key = ? AND kind IN ? AND state = ?",
			userID(c), key,
			[]string{meta.PhotoCollectionKindManual, meta.PhotoCollectionKindSmart},
			meta.PhotoCollectionStateActive,
		).Take(&album).Error; err != nil {
			return err
		}
		currentRevision = album.Revision
		if expected != currentRevision {
			return errRevisionConflict
		}
		if err := validMediaAlbumFolderParent(tx, userID(c), *input.FolderID, 0); err != nil {
			return err
		}
		if album.AlbumFolderID == *input.FolderID {
			return nil
		}
		result := tx.Model(&meta.PhotoCollection{}).
			Where("id = ? AND owner_id = ? AND revision = ?", album.ID, userID(c), expected).
			Updates(map[string]any{
				"album_folder_id": *input.FolderID,
				"revision":        gorm.Expr("revision + 1"),
				"updated_at":      time.Now().UTC(),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errRevisionConflict
		}
		return nil
	})
	if err != nil {
		respondMediaAlbumFolderError(c, err, expected, currentRevision)
		return
	}
	album, err := s.mediaAlbumDTOByKey(c.Request.Context(), userID(c), key)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load album after move failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("%q", strconv.FormatUint(album.Revision, 10)))
	c.JSON(http.StatusOK, album)
}
