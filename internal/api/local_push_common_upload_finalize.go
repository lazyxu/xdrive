package api

import (
	"errors"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errLocalPushCommonUploadUnavailable = errors.New("private common Push operation unavailable")

// persistLocalPushCommonUploadFinalizedTx runs *inside* the ordinary uploader's
// existing CAS/Node/FileVersion/UploadSession transaction. This is NOT a new
// physical commit protocol. Normal upload sessions never reach this helper.
//
// No production code creates a Bound row yet. The next owning-device-only
// admission/bind route must authorize and persist the exact upload Session
// BEFORE allowing Finalize. An unbound lp2_ session cannot claim Push success.
func persistLocalPushCommonUploadFinalizedTx(
	tx *gorm.DB, session meta.UploadSession, resultNodeID uint64,
	contentSHA256 string, size int64, now time.Time,
) error {
	if !strings.HasPrefix(session.ResumeKey, "lp2_") {
		return nil
	}
	deny := errLocalPushCommonUploadUnavailable
	if tx == nil || resultNodeID == 0 || size < 0 ||
		session.ID == "" || session.OwnerID == 0 || session.Status != meta.UploadStatusActive ||
		len(session.ResumeKey) != 68 || session.SHA256 != contentSHA256 ||
		len(contentSHA256) != 64 || now.IsZero() {
		return deny
	}
	var op meta.LocalPushCommonUploadOperation
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("upload_session_id = ? AND owner_id = ? AND resume_key = ?",
			session.ID, session.OwnerID, session.ResumeKey).
		Take(&op).Error; err != nil {
		return deny
	}
	if op.State != meta.LocalPushCommonUploadBound ||
		op.CommittedAt != nil || op.ResultNodeID != nil ||
		op.ResultNodeRevision != 0 ||
		op.OwnerSession == 0 || op.DeviceID == "" || op.RootID == "" ||
		op.RootFingerprint == "" || op.SourceID == 0 || op.SourceRevision == 0 ||
		op.SourceTargetID == 0 || op.ContentSHA256 != contentSHA256 ||
		op.TotalSize != size || op.UploadSessionID == nil ||
		*op.UploadSessionID != session.ID ||
		(op.TargetParentID == nil) == (op.TargetNodeID == nil) ||
		(op.TargetParentID != nil && (session.ParentID == nil ||
			*session.ParentID != *op.TargetParentID ||
			session.NodeID != nil || op.ExpectedRevision != 0 ||
			session.Name != op.TargetName)) ||
		(op.TargetNodeID != nil && (session.NodeID == nil ||
			*session.NodeID != *op.TargetNodeID ||
			session.ParentID != nil || op.ExpectedRevision == 0 ||
			session.ExpectedRevision != op.ExpectedRevision)) {
		return deny
	}
	// Generic upload requests carry Owner JWT, not owning Device credentials.
	// Check the durable, previously authenticated owning scope again UNDER
	// the same transaction so revocation or Source revision drift cannot be
	// acknowledged as a completed local backup.
	var owner meta.User
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND session_version = ? AND disabled_at IS NULL",
			op.OwnerID, op.OwnerSession).Take(&owner).Error; err != nil {
		return deny
	}
	var device meta.ClientDevice
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ? AND revoked_at IS NULL", op.DeviceID, op.OwnerID).
		Take(&device).Error; err != nil {
		return deny
	}
	var source meta.Source
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ? AND revision = ?",
			op.SourceID, op.OwnerID, op.SourceRevision).
		Take(&source).Error; err != nil ||
		source.Kind != meta.SourceKindLocalFolder ||
		source.Direction != meta.SourceDirectionPush ||
		source.SyncMode != meta.SourceSyncModeBackup ||
		source.Status != meta.SourceStatusPaused ||
		source.TargetNodeID == nil || *source.TargetNodeID != op.SourceTargetID {
		return deny
	}
	var binding meta.LocalSourceBinding
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("source_id = ? AND owner_id = ? AND device_id = ?",
			op.SourceID, op.OwnerID, op.DeviceID).
		Take(&binding).Error; err != nil ||
		binding.RootID != op.RootID ||
		binding.RootFingerprint != op.RootFingerprint {
		return deny
	}

	var node meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			resultNodeID, op.OwnerID, meta.NodeTypeFile).
		Take(&node).Error; err != nil {
		return deny
	}
	// Until recursive descendant authorization is implemented, allow only
	// immediate children of this Source's immutable target directory.
	// A forged same-Owner target outside the authorized Source must not pass.
	if node.ParentID == nil || *node.ParentID != op.SourceTargetID ||
		(op.TargetParentID != nil && *op.TargetParentID != op.SourceTargetID) {
		return deny
	}
	if op.TargetNodeID != nil {
		if node.ID != *op.TargetNodeID ||
			node.Revision != op.ExpectedRevision+1 {
			return deny
		}
	} else if node.ParentID == nil || *node.ParentID != *op.TargetParentID ||
		node.Name != op.TargetName || node.Revision != 1 {
		return deny
	}
	var file meta.File
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("node_id = ?", node.ID).Take(&file).Error; err != nil ||
		file.Size != size || file.SHA256 != contentSHA256 ||
		file.StorageKey == "" {
		return deny
	}
	// Capture immutable original Node revision in the SAME transaction;
	// no post-finalize projection from the current mutable Node is accepted.
	change := tx.Model(&meta.LocalPushCommonUploadOperation{}).
		Where("operation_id = ? AND owner_id = ? AND state = ? AND committed_at IS NULL",
			op.OperationID, op.OwnerID, meta.LocalPushCommonUploadBound).
		Updates(map[string]any{
			"state":                meta.LocalPushCommonUploadCommitted,
			"result_node_id":       node.ID,
			"result_node_revision": node.Revision,
			"committed_at":         now,
		})
	if change.Error != nil || change.RowsAffected != 1 {
		return deny
	}
	return nil
}
