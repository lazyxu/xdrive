package api

import (
	"math"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Database-only prototype: no HTTP, Agent IPC, scheduler or production call
// site. This does not attest native/physical CAS bytes; it MUST NOT become an
// executor until a separately verified, crash-safe content protocol exists.
type localPrivateIdentityRenameResult struct {
	SourceItemID uint64
	NodeID       uint64
	NodeRevision uint64
	Replayed     bool
}

// There is deliberately no runtime constructor for this internal witness.
// A boolean is not a cryptographic attestation, and must never come from
// HTTP/IPC JSON. A later owner-Agent protocol must independently prove bytes.
type localPrivateIdentityContentWitness struct {
	sourceID       uint64
	revision       uint64
	sha256         string
	nativeVerified bool
	casVerified    bool
}

// applyLocalQuarantinedSameParentRenameTx is a SINGLE caller-owned database
// transaction. An identity-only rename changes Node metadata revision/name,
// SourceItem canonical identity/path/revision, preserves old identity as an
// alias, and marks the private intent applied. It does not add FileVersion,
// CAS references, SourceRun, content or upload progress. PostgreSQL's existing
// partial UNIQUE idx_xd_nodes_parent_name arbitrates competing names.
func (s *Server) applyLocalQuarantinedSameParentRenameTx(
	tx *gorm.DB, c *gin.Context, sourceID, revision uint64,
	proof localSourceExecutorProof, input localEvidenceCloudMetadataRequest,
	claims []localQuarantinedCurrentPathClaim, witness localPrivateIdentityContentWitness,
) (localPrivateIdentityRenameResult, error) {
	var empty localPrivateIdentityRenameResult
	if tx == nil || c == nil || c.Request == nil || sourceID == 0 || revision == 0 ||
		len(input.Items) != 1 || len(claims) != 1 {
		return empty, errLocalEvidenceConflict
	}
	if !witness.nativeVerified || !witness.casVerified ||
		witness.sourceID != sourceID || witness.revision != revision ||
		witness.sha256 != input.Items[0].SHA256 {
		return empty, errLocalEvidenceConflict
	}
	keys, err := localQuarantinedCurrentPathKeys(proof.RootID, input, claims)
	if err != nil || len(keys) != 1 || claims[0].EvidenceID == 0 {
		return empty, errLocalEvidenceConflict
	}
	boundValue, exists := c.Get(localSourceExecutorContextKey)
	bound, authorized := boundValue.(localSourceExecutorProof)
	if !exists || !authorized || bound != proof || proof.DeviceID == "" ||
		proof.RootID == "" || proof.SourceRevision != revision {
		return empty, errLocalSourceExecutorTransactionUnauthorized
	}
	// Keep device -> Source -> Root locks in revocation-compatible order for
	// both first application and exact replay. Owner JWT is insufficient.
	if err := s.requireLocalSourceProofTx(tx, c, sourceID, "", false); err != nil {
		return empty, err
	}
	var source meta.Source
	if err := tx.Select("id", "owner_id", "revision", "status", "target_node_id").
		Where("id = ? AND owner_id = ?", sourceID, userID(c)).
		Take(&source).Error; err != nil {
		return empty, err
	}
	if source.Revision != revision || source.Status != meta.SourceStatusPaused ||
		source.TargetNodeID == nil {
		return empty, errLocalEvidenceConflict
	}
	var intent meta.LocalSourceCommitIntent
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("source_id = ? AND source_revision = ? AND evidence_id = ?",
			sourceID, revision, claims[0].EvidenceID).
		Take(&intent).Error; err != nil {
		return empty, err
	}
	if intent.DeviceID != proof.DeviceID || intent.RootID != proof.RootID ||
		intent.RootFingerprint != strings.ToLower(strings.TrimSpace(
			c.GetHeader("X-XDrive-Local-Root-Fingerprint"))) ||
		intent.PreviousSnapshotSHA256 != input.PreviousSnapshotSHA256 ||
		intent.CurrentSnapshotSHA256 != input.CurrentSnapshotSHA256 ||
		intent.CurrentPathKey != keys[0] || intent.PreviousPathKey == keys[0] ||
		intent.SourceItemID == 0 {
		return empty, errLocalEvidenceConflict
	}
	var item meta.SourceItem
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND source_id = ?", intent.SourceItemID, sourceID).
		Take(&item).Error; err != nil {
		return empty, err
	}
	if item.NodeID == nil || item.Kind != meta.SourceItemKindFile ||
		item.State != meta.SourceItemStateSynced || item.NodeRevision == 0 ||
		item.SHA256 != input.Items[0].SHA256 || item.Size != input.Items[0].Size {
		return empty, errLocalEvidenceConflict
	}
	if intent.State == meta.LocalSourceCommitIntentStateApplied {
		// Exact crash/timeout replay is readback only; no repeat mutation.
		if item.Path != claims[0].CurrentRelativePath ||
			item.ExternalID != intent.CurrentPathKey {
			return empty, errLocalEvidenceConflict
		}
		var node meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL",
				*item.NodeID, source.OwnerID).Take(&node).Error; err != nil {
			return empty, err
		}
		if node.Revision != item.NodeRevision || node.Type != meta.NodeTypeFile {
			return empty, errLocalEvidenceConflict
		}
		relative, _, err := localQuarantinedLockedNodePathTx(
			tx, source.OwnerID, node.ID, *source.TargetNodeID)
		if err != nil || relative != item.Path {
			return empty, errLocalEvidenceConflict
		}
		var count int64
		if err := tx.Model(&meta.SourceItemAlias{}).
			Where("source_id = ? AND source_item_id = ? AND alias_external_id = ?",
				sourceID, item.ID, intent.PreviousPathKey).
			Count(&count).Error; err != nil || count != 1 {
			return empty, errLocalEvidenceConflict
		}
		return localPrivateIdentityRenameResult{
			SourceItemID: item.ID, NodeID: node.ID,
			NodeRevision: node.Revision, Replayed: true,
		}, c.Request.Context().Err()
	}
	if intent.State != meta.LocalSourceCommitIntentStateQuarantined ||
		item.ExternalID != intent.PreviousPathKey {
		return empty, errLocalEvidenceConflict
	}
	// Exact same-transaction Source/Root/quarantine/alias/Node/FileVersion/CAS
	// and cloud layout/namespace revalidation precedes every canonical write.
	if _, err := s.checkLocalQuarantinedSameDirectoryTargetTx(
		tx, c, sourceID, revision, proof, input, claims); err != nil {
		return empty, err
	}
	var node meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL",
			*item.NodeID, source.OwnerID).Take(&node).Error; err != nil {
		return empty, err
	}
	if node.Revision != item.NodeRevision || node.Revision >= math.MaxInt64 ||
		node.Type != meta.NodeTypeFile || node.ParentID == nil ||
		path.Dir(item.Path) != path.Dir(claims[0].CurrentRelativePath) {
		return empty, errLocalEvidenceConflict
	}
	newName := path.Base(claims[0].CurrentRelativePath)
	now := time.Now().UTC()
	updateNode := tx.Model(&meta.Node{}).
		Where("id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL",
			node.ID, source.OwnerID, node.Revision).
		Updates(map[string]any{
			"name": newName, "revision": node.Revision + 1, "updated_at": now,
		})
	if updateNode.Error != nil {
		if isDuplicate(updateNode.Error) {
			return empty, errLocalEvidenceConflict
		}
		return empty, updateNode.Error
	}
	if updateNode.RowsAffected != 1 {
		return empty, errLocalEvidenceConflict
	}
	index, err := loadSourceIdentityIndex(tx, sourceID,
		[]string{intent.PreviousPathKey, intent.CurrentPathKey})
	if err != nil {
		return empty, err
	}
	current, found, err := index.resolve(intent.PreviousPathKey, nil)
	if err != nil || !found || current.ID != item.ID {
		return empty, errLocalEvidenceConflict
	}
	if err := index.prepareExisting(tx, sourceID, &current,
		intent.CurrentPathKey, nil, true, now); err != nil {
		return empty, err
	}
	updateItem := tx.Model(&meta.SourceItem{}).
		Where("id = ? AND source_id = ? AND external_id = ? AND path = ? AND node_revision = ?",
			item.ID, sourceID, intent.CurrentPathKey, item.Path, item.NodeRevision).
		Updates(map[string]any{
			"path":          claims[0].CurrentRelativePath,
			"node_revision": node.Revision + 1,
			"updated_at":    now,
		})
	if updateItem.Error != nil {
		return empty, updateItem.Error
	}
	if updateItem.RowsAffected != 1 {
		return empty, errLocalEvidenceConflict
	}
	updateIntent := tx.Model(&meta.LocalSourceCommitIntent{}).
		Where("id = ? AND source_id = ? AND state = ?",
			intent.ID, sourceID, meta.LocalSourceCommitIntentStateQuarantined).
		Updates(map[string]any{
			"state":      meta.LocalSourceCommitIntentStateApplied,
			"updated_at": now,
		})
	if updateIntent.Error != nil {
		return empty, updateIntent.Error
	}
	if updateIntent.RowsAffected != 1 {
		return empty, errLocalEvidenceConflict
	}
	if err := c.Request.Context().Err(); err != nil {
		return empty, err
	}
	return localPrivateIdentityRenameResult{
		SourceItemID: item.ID, NodeID: node.ID,
		NodeRevision: node.Revision + 1,
	}, nil
}
