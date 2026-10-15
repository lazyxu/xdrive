package api

import (
	"context"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// localPushExistingCASObservation is an INTERNAL, read-only snapshot for one
// already staged, owning-device authenticated native original and an existing
// ready canonical ContentBlob. It never becomes a commit ticket.
type localPushExistingCASObservation struct {
	stage meta.LocalPushStaging
	blob  meta.ContentBlob
}

// observeBoundLocalPushExistingCAS is a non-operational Server-side bridge
// between the F2d4 physical observer and the already existing transaction-
// bound device/Source/Root/staging authorization. Neither a browser nor an
// Agent IPC/HTTP endpoint can call this helper.
//
// It performs TWO independent short SQL transactions with bounded physical
// I/O OUTSIDE both transactions. This deliberately does NOT retain a CAS SQL
// hash lock or native device authority across the physical read. A positive
// return is an ephemeral precommit observation only, never an authorization
// to publish Node/FileVersion/SourceItem/Run, charge quota or infer deletion.
func (s *Server) observeBoundLocalPushExistingCAS(
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
	return s.observeBoundLocalPushExistingCASWithReader(
		c, sourceID, revision, proof, stageID,
		func(ctx context.Context, stageKey, casKey string, size int64) (bool, error) {
			return local.ObserveMatchingLocalPushStageAndCAS(ctx, stageKey, casKey, size)
		},
	)
}

// Reader injection is deliberately unexported and is used only to test
// revocation/source/stage/metadata changes between the two SQL snapshots.
func (s *Server) observeBoundLocalPushExistingCASWithReader(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID string,
	observe func(context.Context, string, string, int64) (bool, error),
) (bool, error) {
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		sourceID == 0 || revision == 0 || stageID == "" || observe == nil {
		return false, errLocalPushStageConflict
	}
	bound, ok := localPushStageProof(c)
	if !ok || bound != proof || proof.SourceRevision != revision {
		return false, errLocalSourceExecutorTransactionUnauthorized
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), localEvidencePhysicalCASDeadline)
	defer cancel()
	read := func() (localPushExistingCASObservation, error) {
		var snapshot localPushExistingCASObservation
		err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var err error
			snapshot.stage, err = s.loadLocalPushStageTx(tx, c, sourceID, revision, proof, stageID)
			if err != nil {
				return err
			}
			stage := snapshot.stage
			if stage.Status != localPushStageReady ||
				stage.TotalSize < 0 || stage.TotalSize > localPushStageMaxBytes ||
				!validLocalEvidenceDigest(stage.ContentSHA256) ||
				!time.Now().Before(stage.ExpiresAt) {
				return errLocalPushStageConflict
			}
			canonicalKey, err := storage.ContentAddressedKey(stage.ContentSHA256)
			if err != nil {
				return errLocalPushStageConflict
			}
			// Always acquire the canonical hash advisory lock before the
			// ContentBlob row lock, matching the existing CAS GC protocol.
			// Both locks are released BEFORE any physical I/O.
			if err := lockContentHash(tx, stage.ContentSHA256); err != nil {
				return err
			}
			if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
				Where("sha256 = ?", stage.ContentSHA256).
				Take(&snapshot.blob).Error; err != nil {
				return err
			}
			if snapshot.blob.SHA256 != stage.ContentSHA256 ||
				snapshot.blob.StorageKey != canonicalKey ||
				snapshot.blob.Size != stage.TotalSize ||
				snapshot.blob.RefCount <= 0 ||
				snapshot.blob.State != meta.ContentBlobStateReady {
				return errLocalPushStageConflict
			}
			return ctx.Err()
		})
		return snapshot, err
	}

	first, err := read()
	if err != nil {
		return false, err
	}
	stageKey, err := localPushStageStoreKey(first.stage.StageID)
	if err != nil {
		return false, errLocalPushStageConflict
	}
	// Derive canonical CAS only from a fresh DB-scoped digest, never from a
	// renderer/Agent-supplied key or from a previous physical observation.
	matched, err := observe(ctx, stageKey, first.blob.StorageKey, first.stage.TotalSize)
	if err != nil || !matched {
		return false, err // false,nil means nonblocking OS contention
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	second, err := read()
	if err != nil {
		return false, err
	}
	if !sameLocalPushPhysicalScope(first.stage, second.stage) ||
		first.blob.SHA256 != second.blob.SHA256 ||
		first.blob.StorageKey != second.blob.StorageKey ||
		first.blob.Size != second.blob.Size ||
		first.blob.RefCount != second.blob.RefCount ||
		first.blob.State != second.blob.State ||
		!first.blob.UpdatedAt.Equal(second.blob.UpdatedAt) || ctx.Err() != nil {
		return false, fmt.Errorf("%w: local push canonical reuse scope changed", errLocalPushStageConflict)
	}
	return true, nil
}
