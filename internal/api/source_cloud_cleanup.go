package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// A cloud-only cleanup never deletes the Source, provider files, CAS, versions,
// receipts or history. An archived managed destination may be moved to the
// ordinary reversible Trash only after a read-only preview and a second
// transaction-scoped check of the same exact tree/Source revisions.
//
// The usual Files delete routes intentionally reject managed Source trees.
// This narrowly scoped Owner-only path does NOT turn them into writable folders.
var errSourceCloudCleanupBlocked = errors.New("source cloud cleanup not safe")

const maxSourceCloudCleanupNodes = 200000

type sourceCloudCleanupPreviewDTO struct {
	SourceID       uint64 `json:"source_id"`
	SourceRevision uint64 `json:"source_revision"`
	SourceName     string `json:"source_name"`
	TargetNodeID   uint64 `json:"target_node_id"`
	TargetRevision uint64 `json:"target_revision"`
	NodeCount      int    `json:"node_count"`
	FileCount      int    `json:"file_count"`
	PreviewDigest  string `json:"preview_digest"`
	Reversible     bool   `json:"reversible"`
}

type sourceCloudCleanupTree struct {
	source  meta.Source
	target  meta.Node
	ids     []uint64
	preview sourceCloudCleanupPreviewDTO
}

func sourceCloudCleanupIDs(tx *gorm.DB, field string, ids []uint64) (*gorm.DB, error) {
	if len(ids) <= 32000 {
		return tx.Where(field+" IN ?", ids), nil
	}
	arrayLiteral, err := fileOperationDeleteIDArrayLiteral(ids)
	if err != nil {
		return nil, err
	}
	return tx.Where(field+" = ANY(CAST(? AS bigint[]))", arrayLiteral), nil
}

// Source + target must be locked for the destructive half. Source is archived,
// so normal Source uploads and runs are disabled; every known unsettled write,
// active Owner Files operation, overlapping Source, shared Node and active Share
// also blocks deletion. An active Share is deliberately NOT revoked: Trash
// restoration must preserve its prior authority, not silently reissue tokens.
func loadSourceCloudCleanupTreeTx(tx *gorm.DB, ownerID, sourceID uint64, lock bool) (sourceCloudCleanupTree, error) {
	var out sourceCloudCleanupTree
	if tx == nil || ownerID == 0 || sourceID == 0 {
		return out, errSourceCloudCleanupBlocked
	}
	sourceQuery := tx.Where("id = ? AND owner_id = ?", sourceID, ownerID)
	if lock {
		sourceQuery = sourceQuery.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := sourceQuery.Take(&out.source).Error; err != nil {
		return out, err
	}
	src := out.source
	if src.Status != meta.SourceStatusArchived || !src.TargetManaged ||
		src.TargetNodeID == nil || *src.TargetNodeID == 0 || src.RunRequestedAt != nil {
		return out, errSourceCloudCleanupBlocked
	}
	if err := requireSourceNoUnsettledWritesTx(tx, src); err != nil {
		return out, err
	}
	if tx.Migrator().HasTable(&meta.SyncRun{}) {
		var active int64
		if err := tx.Model(&meta.SyncRun{}).
			Where("source_id = ? AND status = ?", src.ID, meta.SyncRunStatusRunning).
			Count(&active).Error; err != nil {
			return out, err
		}
		if active != 0 {
			return out, errSourceCloudCleanupBlocked
		}
	}
	// Queued/retrying Files commands might have been admitted before a Source
	// was archived. Conservatively fence ALL active Owner batch commands.
	if tx.Migrator().HasTable(&meta.FileOperation{}) {
		var active int64
		if err := tx.Model(&meta.FileOperation{}).
			Where("owner_id = ? AND status IN ?", ownerID, []string{
				meta.FileOperationStatusQueued, meta.FileOperationStatusRunning,
				meta.FileOperationStatusCancelRequested,
			}).Count(&active).Error; err != nil {
			return out, err
		}
		if active != 0 {
			return out, errSourceCloudCleanupBlocked
		}
	}
	targetQuery := tx.Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
		*src.TargetNodeID, ownerID, meta.NodeTypeDir)
	if lock {
		targetQuery = targetQuery.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := targetQuery.Take(&out.target).Error; err != nil {
		return out, err
	}
	if out.target.ParentID == nil || out.target.Name != src.Name {
		return out, errSourceCloudCleanupBlocked
	}
	// Fail closed if the Target has lost its originally validated managed
	// namespace. Do not adopt or cleanup an arbitrary legacy directory.
	if _, err := managedSourceTargetAncestorIDsTx(tx, src, out.target); err != nil {
		return out, errSourceCloudCleanupBlocked
	}
	ids, err := activeSubtreeIDsDB(tx, ownerID, out.target.ID)
	if err != nil {
		return out, err
	}
	if len(ids) == 0 || len(ids) > maxSourceCloudCleanupNodes {
		return out, errSourceCloudCleanupBlocked
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	if ids[0] != out.target.ID {
		// The root need not be numerically first if children were relocated;
		// an explicit membership test avoids relying on an ID ordering.
		found := false
		for _, id := range ids {
			if id == out.target.ID {
				found = true
				break
			}
		}
		if !found {
			return out, errSourceCloudCleanupBlocked
		}
	}
	out.ids = ids

	// Another Source or historical SourceItem pointing into this subtree
	// would make even a reversible move violate cross-Source ownership.
	sourceTargetQuery, err := sourceCloudCleanupIDs(tx.Model(&meta.Source{}), "target_node_id", ids)
	if err != nil {
		return out, err
	}
	var overlapping int64
	if err := sourceTargetQuery.Where("owner_id = ? AND id <> ?", ownerID, src.ID).
		Count(&overlapping).Error; err != nil {
		return out, err
	}
	if overlapping != 0 {
		return out, errSourceCloudCleanupBlocked
	}
	if tx.Migrator().HasTable(&meta.SourceItem{}) {
		itemQuery, err := sourceCloudCleanupIDs(tx.Model(&meta.SourceItem{}), "node_id", ids)
		if err != nil {
			return out, err
		}
		var foreignItems int64
		if err := itemQuery.Where("source_id <> ?", src.ID).Count(&foreignItems).Error; err != nil {
			return out, err
		}
		if foreignItems != 0 {
			return out, errSourceCloudCleanupBlocked
		}
	}
	if tx.Migrator().HasTable(&meta.Share{}) {
		shareQuery, err := sourceCloudCleanupIDs(tx.Model(&meta.Share{}), "node_id", ids)
		if err != nil {
			return out, err
		}
		var shares int64
		if err := shareQuery.Where("owner_id = ? AND revoked_at IS NULL", ownerID).
			Count(&shares).Error; err != nil {
			return out, err
		}
		if shares != 0 {
			return out, errSourceCloudCleanupBlocked
		}
	}

	var nodes []struct {
		ID       uint64
		Revision uint64
		Type     string
	}
	nodeQuery, err := sourceCloudCleanupIDs(tx.Model(&meta.Node{}), "id", ids)
	if err != nil {
		return out, err
	}
	if err := nodeQuery.Select("id, revision, type").Order("id ASC").
		Find(&nodes).Error; err != nil {
		return out, err
	}
	if len(nodes) != len(ids) {
		return out, errSourceCloudCleanupBlocked
	}
	digest := sha256.New()
	fmt.Fprintf(digest, "xdrive-source-cloud-trash-v1/%d/%d/%d/%s/%d/%d",
		ownerID, src.ID, src.Revision, src.Name, out.target.ID, out.target.Revision)
	fileCount := 0
	for _, n := range nodes {
		fmt.Fprintf(digest, "/%d:%d:%s", n.ID, n.Revision, n.Type)
		if n.Type == meta.NodeTypeFile {
			fileCount++
		}
	}
	out.preview = sourceCloudCleanupPreviewDTO{
		SourceID: src.ID, SourceRevision: src.Revision, SourceName: src.Name,
		TargetNodeID: out.target.ID, TargetRevision: out.target.Revision,
		NodeCount: len(ids), FileCount: fileCount,
		PreviewDigest: hex.EncodeToString(digest.Sum(nil)), Reversible: true,
	}
	return out, nil
}

func writeSourceCloudCleanupError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		fail(c, http.StatusNotFound, "source or managed target not found")
	case errors.Is(err, errRevisionConflict):
		fail(c, http.StatusConflict, "source revision changed; refresh cleanup preview")
	case errors.Is(err, errSourceCloudCleanupBlocked), errors.Is(err, errSourceUnsettledWrites):
		fail(c, http.StatusConflict, "source cleanup blocked; archive, settle writers, remove active shares or check Source ownership")
	default:
		fail(c, http.StatusInternalServerError, "source cloud cleanup failed")
	}
}

func (s *Server) previewSourceCloudCleanup(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	var plan sourceCloudCleanupTree
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var err error
		plan, err = loadSourceCloudCleanupTreeTx(tx, userID(c), id, false)
		return err
	})
	if err != nil {
		writeSourceCloudCleanupError(c, err)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, plan.preview)
}

func (s *Server) trashSourceCloudCleanup(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	var req struct {
		PreviewDigest  string `json:"preview_digest"`
		ConfirmName    string `json:"confirm_name"`
		TargetNodeID   uint64 `json:"target_node_id"`
		TargetRevision uint64 `json:"target_revision"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.PreviewDigest) != 64 ||
		req.TargetNodeID == 0 || req.TargetRevision == 0 || strings.TrimSpace(req.ConfirmName) == "" {
		fail(c, http.StatusBadRequest, "exact preview and Source name confirmation required")
		return
	}
	var after sourceCloudCleanupPreviewDTO
	var currentRevision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		plan, err := loadSourceCloudCleanupTreeTx(tx, userID(c), id, true)
		if err != nil {
			return err
		}
		currentRevision = plan.source.Revision
		if plan.source.Revision != expected {
			return errRevisionConflict
		}
		p := plan.preview
		if req.ConfirmName != p.SourceName || req.TargetNodeID != p.TargetNodeID ||
			req.TargetRevision != p.TargetRevision || req.PreviewDigest != p.PreviewDigest {
			return errSourceCloudCleanupBlocked
		}
		// No active Share is revoked by this transition. SourceID, history,
		// FileVersions and CAS references remain byte-for-byte unchanged.
		ok, err := markFileOperationDeleteSubtreeTx(tx, userID(c),
			p.TargetNodeID, p.TargetRevision, plan.ids, time.Now().UTC())
		if err != nil {
			return err
		}
		if !ok {
			return errRevisionConflict
		}
		after = p
		return nil
	})
	if err != nil {
		if errors.Is(err, errRevisionConflict) && currentRevision != 0 {
			revisionConflict(c, expected, currentRevision)
		} else {
			writeSourceCloudCleanupError(c, err)
		}
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, gin.H{
		"source_id": after.SourceID, "trash_node_id": after.TargetNodeID,
		"trash_node_revision": after.TargetRevision + 1,
		"node_count":          after.NodeCount, "status": "trashed",
		"restore_path": "/api/v1/trash/" + strconv.FormatUint(after.TargetNodeID, 10) + "/restore",
	})
}
