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

const sourceWriterProofHeader = "X-XDrive-Source-Writer-Proof"

// These functions find the Source by REAL Node ancestry, never by display
// name, caller-supplied path, metadata hints or filename prefix.
type managedSourceLocation struct {
	SourceID uint64 `gorm:"column:source_id"`
	TargetID uint64 `gorm:"column:target_id"`
}

func managedSourceContainingNodeTx(
	ctx context.Context, tx *gorm.DB, ownerID, nodeID uint64,
) (managedSourceLocation, bool, error) {
	if tx == nil || ownerID == 0 || nodeID == 0 || !tx.Migrator().HasTable(&meta.Source{}) {
		return managedSourceLocation{}, false, nil
	}
	var matches []managedSourceLocation
	err := tx.WithContext(ctx).Raw(
		`WITH RECURSIVE ancestors AS (
		  SELECT id, parent_id, 0 AS depth
		  FROM xd_nodes WHERE owner_id = ? AND id = ? AND deleted_at IS NULL
		  UNION ALL
		  SELECT p.id, p.parent_id, a.depth + 1
		  FROM xd_nodes p JOIN ancestors a ON p.id = a.parent_id
		  WHERE p.owner_id = ? AND p.deleted_at IS NULL AND a.depth < 256
		)
		SELECT s.id AS source_id, s.target_node_id AS target_id
		FROM xd_sources s JOIN ancestors a ON a.id = s.target_node_id
		WHERE s.owner_id = ? AND s.target_node_id IS NOT NULL
		LIMIT 2`,
		ownerID, nodeID, ownerID, ownerID,
	).Scan(&matches).Error
	if err != nil {
		return managedSourceLocation{}, false, err
	}
	if len(matches) > 1 {
		return managedSourceLocation{}, false, errManagedSourceTarget
	}
	if len(matches) == 0 {
		return managedSourceLocation{}, false, nil
	}
	return matches[0], true, nil
}

func managedSourceTargetInsideSubtreeTx(
	ctx context.Context, tx *gorm.DB, ownerID, nodeID uint64,
) (bool, error) {
	if tx == nil || ownerID == 0 || nodeID == 0 || !tx.Migrator().HasTable(&meta.Source{}) {
		return false, nil
	}
	var result struct {
		Protected bool `gorm:"column:protected"`
	}
	err := tx.WithContext(ctx).Raw(
		`WITH RECURSIVE tree AS (
		  SELECT id, 0 AS depth
		  FROM xd_nodes WHERE owner_id = ? AND id = ? AND deleted_at IS NULL
		  UNION ALL
		  SELECT child.id, parent.depth + 1
		  FROM xd_nodes child JOIN tree parent ON child.parent_id = parent.id
		  WHERE child.owner_id = ? AND child.deleted_at IS NULL AND parent.depth < 256
		)
		SELECT EXISTS (
		  SELECT 1 FROM xd_sources s JOIN tree t ON t.id = s.target_node_id
		  WHERE s.owner_id = ? AND s.target_node_id IS NOT NULL
		) AS protected`,
		ownerID, nodeID, ownerID, ownerID,
	).Scan(&result).Error
	return result.Protected, err
}

// Only a signed internal Pull-run proof can bypass generic Files write denial.
// The proof is NOT an Owner token, is never accepted as an ordinary JWT, and
// must be rechecked under live Source/Run locks at each final write commit.
func (s *Server) sourceWriterAllowedTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, uid uint64,
	location managedSourceLocation,
) (bool, error) {
	if c == nil || c.Request == nil || location.SourceID == 0 {
		return false, nil
	}
	claims, err := s.Auth.ParseSourceWriter(c.GetHeader(sourceWriterProofHeader))
	if err != nil || claims.OwnerID != uid ||
		claims.SourceID != location.SourceID {
		return false, nil
	}
	var source meta.Source
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ?", location.SourceID, uid).
		First(&source).Error; err != nil {
		return false, err
	}
	if source.TargetNodeID == nil || *source.TargetNodeID != location.TargetID ||
		source.Revision != claims.SourceRevision ||
		source.Direction != meta.SourceDirectionPull ||
		source.Status != meta.SourceStatusActive {
		return false, nil
	}
	var run meta.SyncRun
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND source_id = ?", claims.RunID, source.ID).
		First(&run).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	if run.Status != meta.SyncRunStatusRunning ||
		run.CancelRequestedAt != nil ||
		run.SourceRevision != claims.SourceRevision ||
		run.TargetNodeID == nil || *run.TargetNodeID != location.TargetID {
		return false, nil
	}
	return true, nil
}

func (s *Server) managedSourceNodeWriteTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, uid, nodeID uint64,
) error {
	location, protected, err := managedSourceContainingNodeTx(ctx, tx, uid, nodeID)
	if err != nil { return err }
	if protected {
		if nodeID == location.TargetID {
			return errManagedSourceTarget
		}
		allowed, err := s.sourceWriterAllowedTx(ctx, tx, c, uid, location)
		if err != nil { return err }
		if !allowed { return errManagedSourceTarget }
	}
	nested, err := managedSourceTargetInsideSubtreeTx(ctx, tx, uid, nodeID)
	if err != nil { return err }
	if nested { return errManagedSourceTarget }
	return nil
}

func (s *Server) managedSourceDestinationWriteTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, uid, parentID uint64,
) error {
	location, protected, err := managedSourceContainingNodeTx(ctx, tx, uid, parentID)
	if err != nil { return err }
	if !protected { return nil }
	allowed, err := s.sourceWriterAllowedTx(ctx, tx, c, uid, location)
	if err != nil { return err }
	if !allowed { return errManagedSourceTarget }
	return nil
}

func (s *Server) rejectManagedSourceNodeWrite(c *gin.Context, tx *gorm.DB, nodeID uint64) bool {
	err := s.managedSourceNodeWriteTx(c.Request.Context(), tx, c, userID(c), nodeID)
	return writeManagedSourceMutationError(c, err)
}

func (s *Server) rejectManagedSourceDestinationWrite(c *gin.Context, tx *gorm.DB, parentID uint64) bool {
	err := s.managedSourceDestinationWriteTx(c.Request.Context(), tx, c, userID(c), parentID)
	return writeManagedSourceMutationError(c, err)
}

func writeManagedSourceMutationError(c *gin.Context, err error) bool {
	if err == nil { return false }
	if errors.Is(err, errManagedSourceTarget) {
		fail(c, http.StatusConflict, "managed Source folder can only be changed by its verified sync runner")
	} else {
		fail(c, http.StatusInternalServerError, "managed Source authorization unavailable")
	}
	return true
}

// Pure guards are for public Share sessions and queued FileOperations. Those
// callers have no trusted Source-run transport and cannot mutate Source data.
func denyManagedSourceNodeTx(ctx context.Context, tx *gorm.DB, uid, nodeID uint64) error {
	_, inside, err := managedSourceContainingNodeTx(ctx, tx, uid, nodeID)
	if err != nil { return err }
	if inside { return errManagedSourceTarget }
	nested, err := managedSourceTargetInsideSubtreeTx(ctx, tx, uid, nodeID)
	if err != nil { return err }
	if nested { return errManagedSourceTarget }
	return nil
}
