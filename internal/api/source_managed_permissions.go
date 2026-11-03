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

type sourceRunScope struct {
	sourceID uint64
	runID    string
}

func currentSourceRunScope(c *gin.Context) (sourceRunScope, bool) {
	if c == nil { return sourceRunScope{}, false }
	value, present := c.Get("sourceRunScope")
	scope, ok := value.(sourceRunScope)
	return scope, present && ok && scope.sourceID != 0 && scope.runID != ""
}

var errManagedSourceMutation = errors.New("managed source files are read-only")

// managedSourceForNodeTx resolves a Node's current Source owner from its
// authoritative ancestor IDs. Archived Sources do not own writable targets.
// Multiple claims are corruption, not a reason to pick an arbitrary Source.
func managedSourceForNodeTx(
	ctx context.Context, tx *gorm.DB, uid, nodeID uint64,
) (meta.Source, bool, error) {
	if tx == nil || uid == 0 || nodeID == 0 {
		return meta.Source{}, false, errManagedTargetUnavailable
	}
	if !tx.Migrator().HasTable(&meta.Source{}) {
		return meta.Source{}, false, nil
	}
	var matched []meta.Source
	err := tx.WithContext(ctx).Raw(
		"WITH RECURSIVE ancestors AS ("+
			" SELECT id, parent_id, ARRAY[id] AS ids, 0 AS depth"+
			" FROM xd_nodes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL"+
			" UNION ALL SELECT n.id, n.parent_id, a.ids || n.id, a.depth + 1"+
			" FROM xd_nodes n JOIN ancestors a ON n.id = a.parent_id"+
			" WHERE n.owner_id = ? AND n.deleted_at IS NULL"+
			" AND a.depth < 256 AND NOT n.id = ANY(a.ids)"+
			") SELECT s.* FROM xd_sources s JOIN ancestors a ON s.target_node_id = a.id"+
			" WHERE s.owner_id = ? AND s.status <> ? LIMIT 2",
		nodeID, uid, uid, uid, meta.SourceStatusArchived,
	).Scan(&matched).Error
	if err != nil {
		return meta.Source{}, false, err
	}
	if len(matched) > 1 {
		return meta.Source{}, false, errManagedSourceMutation
	}
	if len(matched) == 0 {
		return meta.Source{}, false, nil
	}
	return matched[0], true, nil
}

func trustedSourceRunMutationTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, source meta.Source,
) (bool, error) {
	if c == nil || tx == nil ||
		(source.Direction != meta.SourceDirectionPull &&
			!(source.Direction == meta.SourceDirectionPush && source.Kind == synologySourceKind)) ||
		source.Status != meta.SourceStatusActive || source.TargetNodeID == nil {
		return false, nil
	}
	value, present := c.Get("sourceRunScope")
	scope, ok := value.(sourceRunScope)
	if !present || !ok || scope.sourceID != source.ID || scope.runID == "" {
		return false, nil
	}
	// Source's SHARE lock serializes all checked writes with archive/target
	// migration. Both Revision and the run's original target must match.
	var locked meta.Source
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Where(
		"id = ? AND owner_id = ? AND status = ?",
		source.ID, source.OwnerID, meta.SourceStatusActive,
	).Take(&locked).Error; err != nil {
		return false, err
	}
	if locked.TargetNodeID == nil || *locked.TargetNodeID != *source.TargetNodeID {
		return false, nil
	}
	var run meta.SyncRun
	if err := tx.WithContext(ctx).Where(
		"id = ? AND source_id = ? AND status = ?",
		scope.runID, source.ID, meta.SyncRunStatusRunning,
	).Take(&run).Error; err != nil {
		return false, nil
	}
	return run.SourceRevision == locked.Revision &&
		run.Mode == meta.SourceRunModeSync && run.TargetNodeID != nil &&
		*run.TargetNodeID == *locked.TargetNodeID &&
		run.CancelRequestedAt == nil, nil
}

// A target root is immutable even to a worker token. Only its descendants
// are mutable through a currently verified SourceRun; ordinary Owner JWT,
// anonymous Share tokens, and stale worker tokens have no write grant.
func managedSourceRejectNodeTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, uid, nodeID uint64,
) error {
	source, found, err := managedSourceForNodeTx(ctx, tx, uid, nodeID)
	if err != nil {
		return err
	}
	if scope, scoped := currentSourceRunScope(c); scoped && (!found || source.ID != scope.sourceID) {
		// A Pull worker capability can only write within its own Source
		// target; it must never become a general-purpose Owner writer.
		return errManagedSourceMutation
	}
	if found {
		if source.TargetNodeID != nil && *source.TargetNodeID == nodeID {
			return errManagedSourceMutation
		}
		allowed, err := trustedSourceRunMutationTx(ctx, tx, c, source)
		if err != nil {
			return err
		}
		if !allowed {
			return errManagedSourceMutation
		}
	}
	// Also prohibit moving/deleting an ancestor that would carry a whole
	// Source target along with it. This is never a file-level Run action.
	contained, err := managedSourceTargetsInSubtreeTx(ctx, tx, uid, nodeID)
	if err != nil {
		return err
	}
	if contained {
		return errManagedSourceMutation
	}
	return nil
}

func managedSourceRejectDestinationTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, uid, parentID uint64,
) error {
	source, found, err := managedSourceForNodeTx(ctx, tx, uid, parentID)
	if err != nil {
		return err
	}
	if scope, scoped := currentSourceRunScope(c); scoped && (!found || source.ID != scope.sourceID) {
		return errManagedSourceMutation
	}
	if !found { return nil }
	allowed, err := trustedSourceRunMutationTx(ctx, tx, c, source)
	if err != nil {
		return err
	}
	if !allowed {
		return errManagedSourceMutation
	}
	return nil
}

func sourceMutationRejectHTTP(c *gin.Context, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errManagedSourceMutation) {
		fail(c, http.StatusConflict, "managed_source_read_only")
	} else {
		fail(c, http.StatusInternalServerError, "managed source authorization unavailable")
	}
	return true
}

func sourceRejectNode(c *gin.Context, tx *gorm.DB, nodeID uint64) bool {
	if c == nil || tx == nil {
		return true
	}
	return sourceMutationRejectHTTP(c,
		managedSourceRejectNodeTx(c.Request.Context(), tx, c, userID(c), nodeID))
}

func sourceRejectDestination(c *gin.Context, tx *gorm.DB, parentID uint64) bool {
	if c == nil || tx == nil {
		return true
	}
	return sourceMutationRejectHTTP(c,
		managedSourceRejectDestinationTx(c.Request.Context(), tx, c, userID(c), parentID))
}
