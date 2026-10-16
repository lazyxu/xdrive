package api

import (
	"context"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
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
func (s *Server) readBoundLocalPushFirstLeafSQLReceipt(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID, relativeLeaf string,
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
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var result localPushFirstLeafSQLReceipt
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
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
		if err := tx.Where("node_id = ? AND storage_key = ? AND sha256 = ? AND size = ?",
			node.ID, casKey, intent.ContentSHA256, intent.TotalSize).
			Take(&file).Error; err != nil {
			return errLocalPushStageConflict
		}
		var item meta.SourceItem
		if err := tx.Where(
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
		return ctx.Err()
	})
	if err != nil {
		return empty, err
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
