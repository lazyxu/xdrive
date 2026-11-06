package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
	// Delete/replace may inspect 100k+ descendant Node IDs. Never expand
	// that list into PostgreSQL bind parameters (the protocol has a limit).
	// Instead query the much smaller set of real Source targets once and
	// match IDs in memory, exactly as the existing Yike guard does.
	var targetIDs []uint64
	if err := db.WithContext(ctx).Table("xd_sources AS s").
		Where("s.owner_id = ? AND s.target_node_id IS NOT NULL AND "+managedTargetPredicate, ownerID).
		Pluck("s.target_node_id", &targetIDs).Error; err != nil {
		return false, err
	}
	if len(targetIDs) == 0 {
		return false, nil
	}
	set := make(map[uint64]struct{}, len(targetIDs))
	for _, targetID := range targetIDs {
		set[targetID] = struct{}{}
	}
	for _, id := range ids {
		if _, found := set[id]; found {
			return true, nil
		}
	}
	return false, nil
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
	if sourceID, proof, ok := currentSynologySourceProof(c); ok {
		err := db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
			return requireSynologySourceNodeMutationTx(c.Request.Context(), tx, c, ownerID, sourceID, proof, nodeID, structural)
		})
		if err != nil {
			fail(c, http.StatusConflict, errManagedSourceWriteDenied.Error())
			return true
		}
		return false
	}
	if _, scoped := currentSourceRunScope(c); scoped {
		// Execution JWT is only a candidate proof; validate Source/Run and
		// Node ancestry here, then repeat in the actual write transaction.
		if err := trustedSourceRunTargetTx(c.Request.Context(), db, c, ownerID, nodeID, !structural); err != nil {
			fail(c, http.StatusConflict, errManagedSourceWriteDenied.Error())
			return true
		}
		return false
	}
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

type sourceRunScope struct {
	sourceID uint64
	runID    string
}

func currentSourceRunScope(c *gin.Context) (sourceRunScope, bool) {
	if c == nil {
		return sourceRunScope{}, false
	}
	value, present := c.Get("sourceRunScope")
	scope, ok := value.(sourceRunScope)
	return scope, present && ok && scope.sourceID != 0 && scope.runID != ""
}

// trustedSourceRunTargetTx never uses a path string for authorization. A signed
// SourceRun is allowed to write only below its current exclusive target, and
// only while Source/Run revisions and status still match. All checks occur at
// the same transaction boundary as the actual Node/CAS mutation.
func trustedSourceRunTargetTx(ctx context.Context, tx *gorm.DB, c *gin.Context, uid, nodeID uint64, allowRoot bool) error {
	scope, scoped := currentSourceRunScope(c)
	if !scoped || uid == 0 || nodeID == 0 || tx == nil {
		return errManagedSourceWriteDenied
	}
	var source meta.Source
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ? AND direction = ? AND status = ?",
			scope.sourceID, uid, meta.SourceDirectionPull, meta.SourceStatusActive).
		Take(&source).Error; err != nil {
		return errManagedSourceWriteDenied
	}
	if source.TargetNodeID == nil || *source.TargetNodeID == 0 ||
		(!source.TargetManaged && source.Kind != yikeSourceKind) {
		return errManagedSourceWriteDenied
	}
	// Legacy Yike Sources are not tagged target_managed yet. Do not let
	// a valid Worker token convert a manually targeted ordinary folder into
	// an implicit writable Source root: verify the canonical ancestors.
	var target meta.Node
	if err := tx.Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
		*source.TargetNodeID, uid, meta.NodeTypeDir).Take(&target).Error; err != nil {
		return errManagedSourceWriteDenied
	}
	if source.Kind == yikeSourceKind {
		// New Yike Sources own their exact user-named leaf and store the
		// verified account identity in Source.ProviderAccountID. A legacy
		// Source still needs the old uid_* proof; names alone grant nothing.
		isNewManagedLeaf := source.TargetManaged && source.ProviderAccountID != "" &&
			target.Name == source.Name
		if !isNewManagedLeaf {
			if _, ok := managedYikeTargetAccountID(target.Name); !ok {
				return errManagedSourceWriteDenied
			}
		}
	}
	if _, err := managedSourceTargetAncestorIDsTx(tx, source, target); err != nil {
		return errManagedSourceWriteDenied
	}
	var run meta.SyncRun
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND source_id = ? AND status = ?",
			scope.runID, source.ID, meta.SyncRunStatusRunning).
		Take(&run).Error; err != nil {
		return errManagedSourceWriteDenied
	}
	if run.SourceRevision != source.Revision || run.Mode != meta.SourceRunModeSync ||
		run.TargetNodeID == nil || *run.TargetNodeID != *source.TargetNodeID ||
		run.CancelRequestedAt != nil {
		return errManagedSourceWriteDenied
	}
	if !allowRoot && nodeID == *source.TargetNodeID {
		return errManagedSourceWriteDenied
	}
	var within bool
	if err := tx.WithContext(ctx).Raw(`
WITH RECURSIVE ancestors AS (
	SELECT id, parent_id FROM xd_nodes
	WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
	UNION
	SELECT p.id, p.parent_id FROM xd_nodes p
	JOIN ancestors a ON p.id = a.parent_id
	WHERE p.owner_id = ? AND p.deleted_at IS NULL
)
SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = ?)`,
		nodeID, uid, uid, *source.TargetNodeID).Scan(&within).Error; err != nil {
		return err
	}
	if !within {
		return errManagedSourceWriteDenied
	}
	// No worker is allowed to mutate a directory containing a different
	// Source root, even when that root was erroneously nested.
	if !allowRoot {
		contained, err := managedSourceTargetInSubtreeDB(ctx, tx, uid, nodeID)
		if err != nil {
			return err
		}
		if contained {
			return errManagedSourceWriteDenied
		}
	}
	return nil
}

// A scoped SourceRun bearer is never upgraded into general Owner authority.
// An ordinary Owner/guest is still read-only inside the managed tree.
func requireSourceRunOrOrdinaryTargetTx(ctx context.Context, tx *gorm.DB, c *gin.Context, uid, parentID uint64) error {
	if _, scoped := currentSourceRunScope(c); scoped {
		return trustedSourceRunTargetTx(ctx, tx, c, uid, parentID, true)
	}
	if sourceID, proof, ok := currentSynologySourceProof(c); ok {
		return requireSynologySourceTargetTx(ctx, tx, c, uid, sourceID, proof, parentID)
	}
	return requireOrdinarySourceTargetTx(ctx, tx, uid, parentID)
}

func requireSourceRunOrOrdinaryMutationTx(ctx context.Context, tx *gorm.DB, c *gin.Context, uid, nodeID uint64) error {
	if _, scoped := currentSourceRunScope(c); scoped {
		return trustedSourceRunTargetTx(ctx, tx, c, uid, nodeID, false)
	}
	if sourceID, proof, ok := currentSynologySourceProof(c); ok {
		return requireSynologySourceNodeMutationTx(ctx, tx, c, uid, sourceID, proof, nodeID, true)
	}
	return requireOrdinarySourceMutationTx(ctx, tx, uid, nodeID)
}

func sourceRunUploadSessionMatches(c *gin.Context, session meta.UploadSession) bool {
	scope, scoped := currentSourceRunScope(c)
	if session.SourceRunID != "" {
		return scoped && scope.runID == session.SourceRunID
	}
	return !scoped
}
