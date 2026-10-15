package api

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// prepareBoundLocalPushNewCAS is an INTERNAL physical-only prerequisite for a
// future new-content writer. It does not create a ContentBlob or grant any
// quota, SourceItem, File, Node, SourceRun, or execution authority.
func (s *Server) prepareBoundLocalPushNewCAS(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID string,
) (bool, error) {
	if s == nil || s.Store == nil {
		return false, errLocalPushStageConflict
	}
	local, ok := s.Store.(*storage.Local)
	if !ok || local == nil {
		return false, errLocalPushStageConflict
	}
	return s.prepareBoundLocalPushNewCASWithMaterializer(
		c, sourceID, revision, proof, stageID, local.MaterializeLocalPushStageCAS,
	)
}

// Materializer injection tests the scope changes across physical I/O. The
// physical phase is ALWAYS outside both SQL transactions: holding a CAS SQL
// advisory lock while waiting for an OS shard would invert the global order.
// Success is ephemeral and cannot be reused as a bearer/commit witness.
func (s *Server) prepareBoundLocalPushNewCASWithMaterializer(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID string,
	materialize func(context.Context, string, string, int64) (bool, bool, error),
) (bool, error) {
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		sourceID == 0 || revision == 0 || stageID == "" || materialize == nil {
		return false, errLocalPushStageConflict
	}
	bound, ok := localPushStageProof(c)
	if !ok || bound != proof || proof.SourceRevision != revision {
		return false, errLocalSourceExecutorTransactionUnauthorized
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), localEvidencePhysicalCASDeadline)
	defer cancel()

	// The absence of authoritative ContentBlob metadata is tested twice.
	// A populated (even failed or unready) row belongs to another lifecycle
	// and must not be repurposed by this physical-only prerequisite.
	read := func() (meta.LocalPushStaging, error) {
		var stage meta.LocalPushStaging
		err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var err error
			stage, err = s.loadLocalPushStageTx(tx, c, sourceID, revision, proof, stageID)
			if err != nil {
				return err
			}
			if stage.Status != localPushStageReady ||
				stage.TotalSize < 0 || stage.TotalSize > localPushStageMaxBytes ||
				!validLocalEvidenceDigest(stage.ContentSHA256) ||
				!time.Now().Before(stage.ExpiresAt) {
				return errLocalPushStageConflict
			}
			// Match GC: canonical hash advisory lock before ContentBlob row
			// inspection. The transaction, and its lock, ends before any I/O.
			if err := lockContentHash(tx, stage.ContentSHA256); err != nil {
				return err
			}
			var blob meta.ContentBlob
			err = tx.Clauses(clause.Locking{Strength: "SHARE"}).
				Where("sha256 = ?", stage.ContentSHA256).Take(&blob).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ctx.Err()
			}
			if err != nil {
				return err
			}
			return errLocalPushStageConflict
		})
		return stage, err
	}

	first, err := read()
	if err != nil {
		return false, err
	}
	stageKey, err := localPushStageStoreKey(first.StageID)
	if err != nil {
		return false, errLocalPushStageConflict
	}
	casKey, err := storage.ContentAddressedKey(first.ContentSHA256)
	if err != nil {
		return false, errLocalPushStageConflict
	}
	// A valid CAS inode might be created and left orphaned if this request
	// later fails. It is NOT a persistent reference, upload or committed file.
	_, admitted, err := materialize(ctx, stageKey, casKey, first.TotalSize)
	if err != nil || !admitted {
		return false, err // busy OS shard is (false,nil), never success
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	second, err := read()
	if err != nil {
		return false, err
	}
	if !sameLocalPushPhysicalScope(first, second) || ctx.Err() != nil {
		return false, fmt.Errorf("%w: local push new-content scope changed", errLocalPushStageConflict)
	}
	return true, nil
}
