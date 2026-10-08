package api

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
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

const (
	trashRangeDefaultLimit = 200
	trashRangeMaxLimit     = 500
)

type trashRangeOptions struct {
	Limit        int
	Offset       int
	Sort         string
	Order        string
	IncludeCount bool
}

type trashRangeDTO struct {
	Items              []nodeDTO `json:"items"`
	TotalCount         int64     `json:"total_count"`
	TotalCountIncluded bool      `json:"total_count_included"`
	Offset             int       `json:"offset"`
	Limit              int       `json:"limit"`
	Sort               string    `json:"sort"`
	Order              string    `json:"order"`
}

type trashRangeRow struct {
	ID         uint64     `gorm:"column:id"`
	ParentID   *uint64    `gorm:"column:parent_id"`
	Name       string     `gorm:"column:name"`
	Type       string     `gorm:"column:type"`
	Revision   uint64     `gorm:"column:revision"`
	DeletedAt  *time.Time `gorm:"column:deleted_at"`
	CreatedAt  time.Time  `gorm:"column:created_at"`
	UpdatedAt  time.Time  `gorm:"column:updated_at"`
	FileSize   int64      `gorm:"column:file_size"`
	FileSHA256 string     `gorm:"column:file_sha256"`
	TotalCount int64      `gorm:"column:total_count"`
}

func (row trashRangeRow) dto() nodeDTO {
	return nodeDTO{
		ID: row.ID, ParentID: row.ParentID, Name: row.Name, Type: row.Type,
		Size: row.FileSize, Revision: row.Revision, SHA256: row.FileSHA256,
		DeletedAt: row.DeletedAt, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func parseTrashRangeOptions(c *gin.Context) (trashRangeOptions, bool) {
	options := trashRangeOptions{
		Limit:        trashRangeDefaultLimit,
		Sort:         strings.TrimSpace(strings.ToLower(c.Query("sort"))),
		Order:        strings.TrimSpace(strings.ToLower(c.Query("order"))),
		IncludeCount: true,
	}
	if options.Sort == "" {
		options.Sort = "name"
	}
	if options.Sort == "updated_at" {
		options.Sort = "updated"
	}
	switch options.Sort {
	case "name", "updated", "size", "type":
	default:
		fail(c, http.StatusBadRequest, "sort must be name, updated, size, or type")
		return trashRangeOptions{}, false
	}
	if options.Order == "" {
		options.Order = "asc"
	}
	if options.Order != "asc" && options.Order != "desc" {
		fail(c, http.StatusBadRequest, "order must be asc or desc")
		return trashRangeOptions{}, false
	}
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			fail(c, http.StatusBadRequest, "offset must be zero or greater")
			return trashRangeOptions{}, false
		}
		options.Offset = value
	}
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > trashRangeMaxLimit {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 500")
			return trashRangeOptions{}, false
		}
		options.Limit = value
	}
	if raw, exists := c.GetQuery("include_count"); exists {
		value, err := strconv.ParseBool(strings.TrimSpace(raw))
		if err != nil {
			fail(c, http.StatusBadRequest, "include_count must be true or false")
			return trashRangeOptions{}, false
		}
		options.IncludeCount = value
	}
	return options, true
}

func (s *Server) trashListRange(c *gin.Context) {
	options, ok := parseTrashRangeOptions(c)
	if !ok {
		return
	}
	rankExpr := "(CASE WHEN xd_nodes.type = 'dir' THEN 0 ELSE 1 END)"
	nameExpr := "lower(xd_nodes.name)"
	sortExpr := nameExpr
	switch options.Sort {
	case "updated":
		sortExpr = "xd_nodes.deleted_at"
	case "size":
		sortExpr = "COALESCE(trash_file.size, 0)"
	case "type":
		sortExpr = "(CASE WHEN xd_nodes.type = 'dir' THEN '' WHEN strpos(xd_nodes.name, '.') > 1 AND right(xd_nodes.name, 1) <> '.' THEN lower(regexp_replace(xd_nodes.name, '^.*\\.', '')) ELSE '' END)"
	}
	direction := "ASC"
	if options.Order == "desc" {
		direction = "DESC"
	}
	orderBy := fmt.Sprintf("%s ASC, %s %s, %s %s, xd_nodes.id %s", rankExpr, sortExpr, direction, nameExpr, direction, direction)
	newQuery := func() *gorm.DB {
		return s.DB.
			Table("xd_nodes").
			Joins("LEFT JOIN xd_files AS trash_file ON trash_file.node_id = xd_nodes.id").
			Where("xd_nodes.owner_id = ? AND xd_nodes.deleted_at IS NOT NULL AND xd_nodes.trash_root_id = xd_nodes.id", userID(c))
	}
	selectClause := `xd_nodes.id, xd_nodes.parent_id, xd_nodes.name, xd_nodes.type,
		xd_nodes.revision, xd_nodes.deleted_at, xd_nodes.created_at, xd_nodes.updated_at,
		COALESCE(trash_file.size, 0) AS file_size,
		COALESCE(trash_file.sha256, '') AS file_sha256`
	if options.IncludeCount {
		selectClause += ", COUNT(*) OVER() AS total_count"
	}
	var rows []trashRangeRow
	if err := newQuery().
		Select(selectClause).
		Order(orderBy).
		Offset(options.Offset).
		Limit(options.Limit).
		Scan(&rows).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list trash failed")
		return
	}
	var totalCount int64
	if options.IncludeCount {
		if len(rows) > 0 {
			totalCount = rows[0].TotalCount
		} else if err := newQuery().Count(&totalCount).Error; err != nil {
			fail(c, http.StatusInternalServerError, "count trash failed")
			return
		}
	}
	items := make([]nodeDTO, 0, len(rows))
	for _, row := range rows {
		items = append(items, row.dto())
	}
	c.JSON(http.StatusOK, trashRangeDTO{
		Items: items, TotalCount: totalCount, TotalCountIncluded: options.IncludeCount,
		Offset: options.Offset, Limit: options.Limit, Sort: options.Sort, Order: options.Order,
	})
}

func (s *Server) trashList(c *gin.Context) {
	if raw, exists := c.GetQuery("range"); exists {
		if strings.TrimSpace(strings.ToLower(raw)) != "true" {
			fail(c, http.StatusBadRequest, "range must be true")
			return
		}
		s.trashListRange(c)
		return
	}
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
	var contentDeletes []contentDeleteCandidate
	var legacyKeys []string
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
		var releaseErr error
		contentDeletes, legacyKeys, releaseErr = s.releaseContentReferencesTx(tx, files, versions)
		if releaseErr != nil {
			return releaseErr
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
		if err := recordAuditTx(tx, auditEventFromContext(c, auditpkg.ActionPermanentDelete, "node",
			fmt.Sprintf("%d", id), "", auditpkg.ResultSuccess, map[string]any{
				"subtree_nodes": len(ids), "file_count": len(files), "version_count": len(versions),
			})); err != nil {
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
	s.finalizeContentBlobDeletes(c.Request.Context(), contentDeletes)
	s.deleteLegacyStorageKeys(c.Request.Context(), legacyKeys)
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
	metadata, err := loadFileVersionDownloadMetadata(
		c.Request.Context(),
		s.DB,
		userID(c),
		id,
		versionID,
	)
	if err != nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if !metadata.VersionFound {
		fail(c, http.StatusNotFound, "version not found")
		return
	}
	f, err := s.Store.Open(c.Request.Context(), metadata.StorageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "stored version not found")
		return
	}
	defer f.Close()
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(metadata.Name))
	if metadata.SHA256 != "" {
		c.Header("X-Content-SHA256", metadata.SHA256)
	}
	http.ServeContent(c.Writer, c.Request, metadata.Name, metadata.CreatedAt, f)
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
		if err := tx.Model(&meta.Node{}).
			Where("id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL", id, userID(c), expected).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now}).Error; err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(c, auditpkg.ActionVersionRestore, "file",
			fmt.Sprintf("%d", id), "", auditpkg.ResultSuccess, map[string]any{
				"restored_version_id": versionID, "restored_revision": selected.Revision,
				"previous_revision": expected,
			}))
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

type activeSubtreeSummary struct {
	IDs   []uint64
	Bytes int64
}

func activeSubtreeSummariesDB(
	db *gorm.DB,
	uid uint64,
	roots []uint64,
) (map[uint64]activeSubtreeSummary, error) {
	summaries := make(map[uint64]activeSubtreeSummary, len(roots))
	if len(roots) == 0 {
		return summaries, nil
	}

	uniqueRoots := make(map[uint64]struct{}, len(roots))
	rootIDs := make([]uint64, 0, len(roots))
	for _, root := range roots {
		if _, exists := uniqueRoots[root]; exists {
			continue
		}
		uniqueRoots[root] = struct{}{}
		rootIDs = append(rootIDs, root)
	}

	type row struct {
		RootID   uint64 `gorm:"column:root_id"`
		ID       uint64 `gorm:"column:id"`
		Bytes    int64  `gorm:"column:bytes"`
		Overflow bool   `gorm:"column:overflow"`
	}
	var rows []row
	err := db.Raw(`WITH RECURSIVE roots AS (
SELECT id
FROM xd_nodes
WHERE id IN ? AND owner_id = ? AND deleted_at IS NULL
),
tree AS (
SELECT roots.id AS root_id, roots.id AS id
FROM roots
UNION ALL
SELECT tree.root_id, n.id
FROM tree
JOIN xd_nodes n ON n.parent_id = tree.id
WHERE n.owner_id = ? AND n.deleted_at IS NULL
),
stats AS (
SELECT tree.root_id, COALESCE(SUM(f.size), 0)::numeric AS bytes
FROM tree
LEFT JOIN xd_files f ON f.node_id = tree.id
GROUP BY tree.root_id
)
SELECT tree.root_id,
       tree.id,
       CASE
         WHEN stats.bytes > 9223372036854775807 THEN 9223372036854775807
         WHEN stats.bytes < -9223372036854775808 THEN -9223372036854775808
         ELSE stats.bytes
       END::bigint AS bytes,
       (
         stats.bytes > 9223372036854775807 OR
         stats.bytes < -9223372036854775808
       ) AS overflow
FROM tree
JOIN stats ON stats.root_id = tree.root_id
ORDER BY tree.root_id, tree.id`, rootIDs, uid, uid).Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		if row.Overflow {
			return nil, errors.New("file operation size overflow")
		}
		summary := summaries[row.RootID]
		summary.IDs = append(summary.IDs, row.ID)
		summary.Bytes = row.Bytes
		summaries[row.RootID] = summary
	}
	if len(summaries) != len(rootIDs) {
		return nil, gorm.ErrRecordNotFound
	}
	return summaries, nil
}

func activeSubtreeSummaryDB(db *gorm.DB, uid, root uint64) (activeSubtreeSummary, error) {
	summaries, err := activeSubtreeSummariesDB(db, uid, []uint64{root})
	if err != nil {
		return activeSubtreeSummary{}, err
	}
	summary, ok := summaries[root]
	if !ok {
		return activeSubtreeSummary{}, gorm.ErrRecordNotFound
	}
	return summary, nil
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
