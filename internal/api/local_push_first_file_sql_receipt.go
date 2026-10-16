package api

import (
	"context"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm/clause"
)

// localPushFirstLeafSQLReceipt is a PRIVATE SQL-only diagnostic result.
// Even a matching record proves neither native-original provenance nor
// physical CAS availability or backup completion.
const localPushFirstLeafSQLReceiptState = "sql_committed_physical_unverified"

type localPushFirstLeafSQLReceipt struct {
	NodeID       uint64
	SourceItemID uint64
	State        string
}

// readBoundLocalPushFirstLeafSQLReceipt is an INTERNAL, read-only recovery
// prerequisite for a previously committed direct-child first file. Unlike
// Stage replay, it can inspect the immutable hold and prepare intent AFTER
// the Stage expired or was replaced. It never trusts an Owner JWT alone:
// an enrolled unrevoked owning device, current Root and unchanged paused
// Source revision are verified inside the same PostgreSQL transaction.
//
// NO HTTP route, Agent IPC, GUI or scheduler calls this method. A positive
// SQL receipt MUST NOT be presented as a complete or physically restorable
// backup: actual canonical CAS bytes and native-file provenance are NOT
// checked by this path.
// readBoundLocalPushFirstLeafSQLReceipt retains the SQL-only historical
// diagnostic contract. The optional CAS observer below is never used by
// ordinary SQL receipt callers or the existing Web/Desktop/API routes.
func (s *Server) readBoundLocalPushFirstLeafSQLReceipt(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID, relativeLeaf string,
) (localPushFirstLeafSQLReceipt, error) {
	return s.readBoundLocalPushFirstLeafReceiptWithCASInspector(
		c, sourceID, revision, proof, stageID, relativeLeaf, nil,
	)
}

const localPushFirstLeafPhysicalReceiptState = "sql_committed_cas_observed_native_unverified"

// readBoundLocalPushFirstLeafPhysicalReceipt is a Server-only recovery
// diagnostic that verifies current physical CAS bytes even after Stage
// replacement. It does NOT certify native-source provenance, durable backup
// success, restoration or SourceRun completion; it has NO public route.
func (s *Server) readBoundLocalPushFirstLeafPhysicalReceipt(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID, relativeLeaf string,
) (localPushFirstLeafSQLReceipt, error) {
	if s == nil || s.Store == nil {
		return localPushFirstLeafSQLReceipt{}, errLocalPushStageConflict
	}
	local, ok := s.Store.(*storage.Local)
	if !ok || local == nil {
		return localPushFirstLeafSQLReceipt{}, errLocalPushStageConflict
	}
	receipt, err := s.readBoundLocalPushFirstLeafReceiptWithCASInspector(
		c, sourceID, revision, proof, stageID, relativeLeaf,
		local.InspectPinnedLocalPushHistoricalCAS,
	)
	if err != nil {
		return localPushFirstLeafSQLReceipt{}, err
	}
	receipt.State = localPushFirstLeafPhysicalReceiptState
	return receipt, nil
}

// Inspectors are internal and test-injectable; only the production Local
// Store can establish a physical CAS observation. A synthetic inspector
// can never grant an upload action because this function is unexported,
// read-only, and has no network/IPC/Renderer caller.
func (s *Server) readBoundLocalPushFirstLeafReceiptWithCASInspector(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID, relativeLeaf string,
	inspect func(context.Context, string, int64, func(context.Context) error) (bool, error),
) (localPushFirstLeafSQLReceipt, error) {
	var empty localPushFirstLeafSQLReceipt
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		sourceID == 0 || revision == 0 || stageID == "" {
		return empty, errLocalPushStageConflict
	}
	bound, ok := localPushStageProof(c)
	if !ok || bound != proof || proof.SourceRevision != revision {
		return empty, errLocalSourceExecutorTransactionUnauthorized
	}
	if _, err := localPushStageStoreKey(stageID); err != nil {
		return empty, errLocalPushStageConflict
	}
	pathKey, err := localPushFirstLeafPathKey(proof.RootID, relativeLeaf)
	if err != nil {
		return empty, err
	}
	deadline := 10 * time.Second
	if inspect != nil {
		deadline = localEvidencePhysicalCASDeadline
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), deadline)
	defer cancel()

	tx := s.DB.WithContext(ctx).Begin()
	if tx.Error != nil {
		return empty, tx.Error
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback().Error
		}
	}()
	var result localPushFirstLeafSQLReceipt
	var physicalCASKey string
	var physicalCASSize int64
	err = func() error {
		// Preserve quota-writer ordering: User before owning Device/Source/
		// Root, then canonical CAS hash, Blob, quarantine and receipt.
		var owner meta.User
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ?", userID(c)).Take(&owner).Error; err != nil {
			return err
		}
		source, err := s.checkLocalPushStageScopeTx(tx, c, sourceID, revision, proof)
		if err != nil {
			return err
		}
		// No live Stage lookup: committed Stage slots may be expired or
		// replaced by the next candidate for this same paused Source.
		// Read the immutable quarantine once to derive the CAS hash,
		// then lock that hash and repeat the row read under a SQL lock.
		var hint meta.LocalPushCASPrepareIntent
		if err := tx.Where("stage_id = ? AND source_id = ? AND owner_id = ?",
			stageID, sourceID, userID(c)).Take(&hint).Error; err != nil {
			return err
		}
		if !validLocalEvidenceDigest(hint.ContentSHA256) ||
			hint.CurrentPathKey != pathKey || hint.SourceRevision != revision {
			return errLocalPushStageConflict
		}
		if err := lockContentHash(tx, hint.ContentSHA256); err != nil {
			return err
		}
		var blob meta.ContentBlob
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("sha256 = ?", hint.ContentSHA256).Take(&blob).Error; err != nil {
			return err
		}
		var intent meta.LocalPushCASPrepareIntent
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("stage_id = ? AND source_id = ? AND owner_id = ?",
				stageID, sourceID, userID(c)).Take(&intent).Error; err != nil {
			return err
		}
		if !sameLocalPushReceiptIntentScope(c, intent, source, proof, pathKey) ||
			intent.ContentSHA256 != hint.ContentSHA256 ||
			!validLocalEvidenceDigest(intent.CurrentSnapshotSHA256) ||
			intent.TotalSize < 0 || intent.TotalSize > localPushStageMaxBytes {
			return errLocalPushStageConflict
		}
		var hold meta.LocalPushQuotaHold
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("stage_id = ? AND owner_id = ?", stageID, userID(c)).
			Take(&hold).Error; err != nil {
			return err
		}
		if !sameLocalPushReceiptHoldScope(hold, intent) ||
			hold.ReleasedAt == nil || hold.CommittedAt == nil ||
			hold.CommittedNodeID == nil || *hold.CommittedNodeID == 0 ||
			hold.CommittedSourceItemID == nil || *hold.CommittedSourceItemID == 0 {
			return errLocalPushStageConflict
		}
		casKey, err := storage.ContentAddressedKey(intent.ContentSHA256)
		if err != nil || blob.State != meta.ContentBlobStateReady ||
			blob.SHA256 != intent.ContentSHA256 || blob.StorageKey != casKey ||
			blob.Size != intent.TotalSize || blob.RefCount < 1 {
			return errLocalPushStageConflict
		}
		var target meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				intent.TargetNodeID, intent.OwnerID, meta.NodeTypeDir).
			Take(&target).Error; err != nil {
			return errLocalPushStageConflict
		}
		var node meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ? AND parent_id = ? AND name = ? AND type = ? AND deleted_at IS NULL AND revision = ?",
				*hold.CommittedNodeID, intent.OwnerID, target.ID, relativeLeaf, meta.NodeTypeFile, 1).
			Take(&node).Error; err != nil {
			return errLocalPushStageConflict
		}
		var file meta.File
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("node_id = ? AND storage_key = ? AND sha256 = ? AND size = ?",
				node.ID, casKey, intent.ContentSHA256, intent.TotalSize).
			Take(&file).Error; err != nil {
			return errLocalPushStageConflict
		}
		var item meta.SourceItem
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Where(
			"id = ? AND source_id = ? AND external_id = ? AND node_id = ? AND node_revision = ? AND path = ? AND size = ? AND sha256 = ? AND kind = ? AND state = ? AND last_synced_at IS NULL AND last_synced_run_id = ?",
			*hold.CommittedSourceItemID, sourceID, pathKey, node.ID, node.Revision,
			relativeLeaf, intent.TotalSize, intent.ContentSHA256,
			meta.SourceItemKindFile, meta.SourceItemStatePending, "",
		).Take(&item).Error; err != nil {
			return errLocalPushStageConflict
		}
		result = localPushFirstLeafSQLReceipt{
			NodeID: node.ID, SourceItemID: item.ID,
			State: localPushFirstLeafSQLReceiptState,
		}
		physicalCASKey = casKey
		physicalCASSize = intent.TotalSize
		return ctx.Err()
	}()
	if err != nil {
		return empty, err
	}
	if inspect == nil {
		if err := tx.Commit().Error; err != nil {
			return empty, err
		}
		committed = true
		return result, nil
	}

	// The SQL-only receipt has already been fully checked with the
	// owning-device and CAS hash locks held. Only now admit the CAS OS
	// shared shard with a try-lock. COMMIT the read-only SQL transaction
	// while its actual inode is pinned; the observer hashes bytes a second
	// time before returning success, and closes the pin on every path.
	callbackRan := false
	matched, err := inspect(ctx, physicalCASKey, physicalCASSize,
		func(heldCtx context.Context) error {
			if err := heldCtx.Err(); err != nil {
				return err
			}
			callbackRan = true
			if err := tx.Commit().Error; err != nil {
				return err
			}
			committed = true
			return nil
		})
	if err != nil {
		return empty, err
	}
	if !matched || !callbackRan || !committed || ctx.Err() != nil {
		return empty, errLocalPushStageConflict
	}
	return result, nil
}

// This intentionally compares only immutable SQL scope, not the Stage's
// expiration against wall-clock time. A historical receipt has no authority
// to resume a stale Stage, begin SourceRun or confirm physical data.
func sameLocalPushReceiptIntentScope(
	c *gin.Context, intent meta.LocalPushCASPrepareIntent,
	source meta.Source, proof localSourceExecutorProof, pathKey string,
) bool {
	return intent.StageID != "" &&
		intent.State == meta.LocalPushCASPrepareIntentQuarantined &&
		intent.SourceID == source.ID && intent.OwnerID == userID(c) &&
		intent.SourceRevision == proof.SourceRevision &&
		intent.DeviceID == proof.DeviceID && intent.RootID == proof.RootID &&
		intent.RootFingerprint == strings.ToLower(strings.TrimSpace(
			c.GetHeader("X-XDrive-Local-Root-Fingerprint"))) &&
		source.TargetNodeID != nil &&
		intent.TargetNodeID == *source.TargetNodeID &&
		intent.CurrentPathKey == pathKey && !intent.StageExpiresAt.IsZero()
}

func sameLocalPushReceiptHoldScope(
	hold meta.LocalPushQuotaHold, intent meta.LocalPushCASPrepareIntent,
) bool {
	return hold.StageID == intent.StageID && hold.OwnerID == intent.OwnerID &&
		hold.SourceID == intent.SourceID &&
		hold.SourceRevision == intent.SourceRevision &&
		hold.DeviceID == intent.DeviceID && hold.RootID == intent.RootID &&
		hold.RootFingerprint == intent.RootFingerprint &&
		hold.TargetNodeID == intent.TargetNodeID &&
		hold.ContentSHA256 == intent.ContentSHA256 &&
		hold.Bytes == intent.TotalSize && hold.ExpiresAt.Equal(intent.StageExpiresAt)
}
