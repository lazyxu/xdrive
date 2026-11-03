package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

var errManagedSourceWriteDenied = errors.New("managed source target is read-only")

// A server-bound target is an authoritative Source/Node relationship, not a
// name prefix. Legacy manually selected targets are never adopted merely
// because they happen to sit inside the canonical sync-folder hierarchy.
// The existing Yike target is server-bound before target_managed was added.
const managedTargetPredicate = "(s.target_managed = TRUE OR (s.kind = 'yike_photos' AND s.direction = 'pull'))"

func managedSourceGuardEnabled(db *gorm.DB) bool {
	return db != nil && db.Migrator().HasTable(&meta.Source{})
}

// managedSourceNodeInTargetDB blocks regular Files writes on the managed root
// and all its descendants, including files that have direct Share tokens.
func managedSourceNodeInTargetDB(ctx context.Context, db *gorm.DB, ownerID, nodeID uint64) (bool, error) {
	if !managedSourceGuardEnabled(db) || ownerID == 0 || nodeID == 0 {
		return false, nil
	}
	var protected bool
	err := db.WithContext(ctx).Raw(`
WITH RECURSIVE ancestors AS (
	SELECT id, parent_id, 0 AS depth FROM xd_nodes
	WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
	UNION ALL
	SELECT p.id, p.parent_id, a.depth + 1
	FROM xd_nodes p JOIN ancestors a ON p.id = a.parent_id
	WHERE p.owner_id = ? AND p.deleted_at IS NULL AND a.depth < 128
)
SELECT EXISTS (
	SELECT 1 FROM xd_sources s JOIN ancestors a ON a.id = s.target_node_id
	WHERE s.owner_id = ? AND `+managedTargetPredicate+`
)`, nodeID, ownerID, ownerID, ownerID).Scan(&protected).Error
	return protected, err
}

// managedSourceTargetInSubtreeDB protects ancestors of a managed root against
// ordinary moves, deletion, replacement and reparenting.
func managedSourceTargetInSubtreeDB(ctx context.Context, db *gorm.DB, ownerID, nodeID uint64) (bool, error) {
	if !managedSourceGuardEnabled(db) || ownerID == 0 || nodeID == 0 {
		return false, nil
	}
	var protected bool
	err := db.WithContext(ctx).Raw(`
WITH RECURSIVE subtree AS (
	SELECT id FROM xd_nodes
	WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
	UNION ALL
	SELECT child.id FROM xd_nodes child JOIN subtree parent ON child.parent_id = parent.id
	WHERE child.owner_id = ? AND child.deleted_at IS NULL
)
SELECT EXISTS (
	SELECT 1 FROM xd_sources s JOIN subtree d ON d.id = s.target_node_id
	WHERE s.owner_id = ? AND `+managedTargetPredicate+`
)`, nodeID, ownerID, ownerID, ownerID).Scan(&protected).Error
	return protected, err
}

func managedSourceTargetInIDsDB(ctx context.Context, db *gorm.DB, ownerID uint64, ids []uint64) (bool, error) {
	if !managedSourceGuardEnabled(db) || ownerID == 0 || len(ids) == 0 {
		return false, nil
	}
	var protected bool
	err := db.WithContext(ctx).Raw(`
SELECT EXISTS (
	SELECT 1 FROM xd_sources s WHERE s.owner_id = ?
	AND `+managedTargetPredicate+` AND s.target_node_id IN ?
)`, ownerID, ids).Scan(&protected).Error
	return protected, err
}

func managedSourceMutationTouchesDB(ctx context.Context, db *gorm.DB, ownerID, nodeID uint64) (bool, error) {
	inside, err := managedSourceNodeInTargetDB(ctx, db, ownerID, nodeID)
	if inside || err != nil {
		return inside, err
	}
	return managedSourceTargetInSubtreeDB(ctx, db, ownerID, nodeID)
}

// This function is called at the write transaction boundary, not only from
// UI preflight. File copies may read protected Sources, but their DESTINATION
// must be an ordinary writable directory.
func requireOrdinarySourceTargetTx(ctx context.Context, tx *gorm.DB, ownerID, nodeID uint64) error {
	protected, err := managedSourceNodeInTargetDB(ctx, tx, ownerID, nodeID)
	if err != nil {
		return err
	}
	if protected {
		return errManagedSourceWriteDenied
	}
	return nil
}

func requireOrdinarySourceMutationTx(ctx context.Context, tx *gorm.DB, ownerID, nodeID uint64) error {
	protected, err := managedSourceMutationTouchesDB(ctx, tx, ownerID, nodeID)
	if err != nil {
		return err
	}
	if protected {
		return errManagedSourceWriteDenied
	}
	return nil
}

func managedSourceWritePreflight(c *gin.Context, db *gorm.DB, ownerID, nodeID uint64, structural bool) bool {
	var protected bool
	var err error
	if structural {
		protected, err = managedSourceMutationTouchesDB(c.Request.Context(), db, ownerID, nodeID)
	} else {
		protected, err = managedSourceNodeInTargetDB(c.Request.Context(), db, ownerID, nodeID)
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, "check managed source destination failed")
		return true
	}
	if protected {
		fail(c, http.StatusConflict, errManagedSourceWriteDenied.Error())
		return true
	}
	return false
}
