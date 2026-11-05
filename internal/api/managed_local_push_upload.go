package api

import (
	"context"
	"errors"
	"strings"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// A generic Owner UploadSession can stage bytes for a managed Local Push
// target only when an earlier, owning-device-authenticated private Operation
// has reserved the EXACT source, target, filename, revision and content.
// Merely using the lp2_ prefix is never sufficient authorization.
func requireOrdinaryOrAdmittedLocalPushTargetTx(
	ctx context.Context, tx *gorm.DB, uid, targetID uint64, req uploadInitRequest,
) error {
	err := requireOrdinarySourceTargetTx(ctx, tx, uid, targetID)
	if err == nil || !errors.Is(err, errManagedSourceWriteDenied) {
		return err
	}
	_, err = admittedManagedLocalPushOperationTx(ctx, tx, uid, targetID, req)
	if err != nil {
		return errManagedSourceWriteDenied
	}
	return nil
}

func requireOrdinaryOrBoundLocalPushFinalizeTx(
	ctx context.Context, tx *gorm.DB, session meta.UploadSession, targetID uint64,
) error {
	err := requireOrdinarySourceTargetTx(ctx, tx, session.OwnerID, targetID)
	if err == nil || !errors.Is(err, errManagedSourceWriteDenied) {
		return err
	}
	if session.ShareID != nil || session.ID == "" ||
		session.Status != meta.UploadStatusActive {
		return errManagedSourceWriteDenied
	}
	req := uploadInitRequest{
		ParentID: session.ParentID, NodeID: session.NodeID,
		Name: session.Name, Size: session.TotalSize, SHA256: session.SHA256,
		ResumeKey: session.ResumeKey, ExpectedRevision: session.ExpectedRevision,
		ConflictPolicy: session.ConflictPolicy,
	}
	op, err := admittedManagedLocalPushOperationTx(
		ctx, tx, session.OwnerID, targetID, req)
	if err != nil || op.State != meta.LocalPushCommonUploadBound ||
		op.UploadSessionID == nil || *op.UploadSessionID != session.ID {
		return errManagedSourceWriteDenied
	}
	// persistLocalPushCommonUploadFinalizedTx will additionally verify the
	// original device/Root credentials, current Node, CAS and terminal result
	// in this SAME transaction. If any check fails all File writes roll back.
	return nil
}

func admittedManagedLocalPushOperationTx(
	ctx context.Context, tx *gorm.DB, uid, targetID uint64, req uploadInitRequest,
) (meta.LocalPushCommonUploadOperation, error) {
	var op meta.LocalPushCommonUploadOperation
	deny := errManagedSourceWriteDenied
	if tx == nil || uid == 0 || targetID == 0 || req.Size < 0 ||
		req.ConflictPolicy != meta.UploadConflictPolicyFail ||
		len(req.ResumeKey) != 68 || !strings.HasPrefix(req.ResumeKey, "lp2_") ||
		!validSHA256(req.ResumeKey[4:]) || !validSHA256(req.SHA256) ||
		req.SHA256 != strings.ToLower(req.SHA256) ||
		(req.ParentID == nil) == (req.NodeID == nil) {
		return op, deny
	}
	if err := tx.WithContext(ctx).Clauses(clause.Locking{
		Strength: "SHARE", Options: "NOWAIT",
	}).Where("owner_id = ? AND resume_key = ? AND state IN ? AND committed_at IS NULL",
		uid, req.ResumeKey,
		[]string{meta.LocalPushCommonUploadReserved, meta.LocalPushCommonUploadBound},
	).Take(&op).Error; err != nil {
		return op, deny
	}
	if op.OwnerID != uid || op.OperationID == "" || op.SourceID == 0 ||
		op.OwnerSession == 0 || op.DeviceID == "" || op.RootID == "" ||
		op.RootFingerprint == "" || op.SourceRevision == 0 ||
		op.SourceTargetID == 0 || op.ContentSHA256 != req.SHA256 ||
		op.TotalSize != req.Size ||
		(op.TargetParentID == nil) == (op.TargetNodeID == nil) {
		return op, deny
	}
	if req.ParentID != nil {
		// A parent may be a nested folder inside this Source's managed root,
		// not just the root itself. The ancestry is verified below.
		if op.TargetParentID == nil || *op.TargetParentID != *req.ParentID ||
			op.TargetNodeID != nil || req.Name != op.TargetName ||
			req.ExpectedRevision != 0 || op.ExpectedRevision != 0 ||
			meta.ValidateName(req.Name) != nil {
			return op, deny
		}
	} else if req.NodeID == nil || op.TargetNodeID == nil ||
		*req.NodeID != *op.TargetNodeID ||
		op.TargetParentID != nil || req.ExpectedRevision == 0 ||
		req.ExpectedRevision != op.ExpectedRevision {
		return op, deny
	}

	var owner meta.User
	if err := tx.WithContext(ctx).Clauses(clause.Locking{
		Strength: "SHARE", Options: "NOWAIT",
	}).Where("id = ? AND session_version = ? AND disabled_at IS NULL",
		uid, op.OwnerSession).Take(&owner).Error; err != nil {
		return op, deny
	}
	var source meta.Source
	if err := tx.WithContext(ctx).Clauses(clause.Locking{
		Strength: "SHARE", Options: "NOWAIT",
	}).Where("id = ? AND owner_id = ? AND revision = ?",
		op.SourceID, uid, op.SourceRevision).Take(&source).Error; err != nil {
		return op, deny
	}
	if source.Kind != meta.SourceKindLocalFolder ||
		source.Direction != meta.SourceDirectionPush ||
		source.DeviceID == nil || *source.DeviceID != op.DeviceID ||
		source.SyncMode != meta.SourceSyncModeBackup ||
		source.Status != meta.SourceStatusPaused || !source.TargetManaged ||
		source.TargetNodeID == nil || *source.TargetNodeID != op.SourceTargetID {
		return op, deny
	}
	var device meta.ClientDevice
	if err := tx.WithContext(ctx).Clauses(clause.Locking{
		Strength: "SHARE", Options: "NOWAIT",
	}).Where("id = ? AND owner_id = ? AND revoked_at IS NULL",
		op.DeviceID, uid).Take(&device).Error; err != nil {
		return op, deny
	}
	var binding meta.LocalSourceBinding
	if err := tx.WithContext(ctx).Clauses(clause.Locking{
		Strength: "SHARE", Options: "NOWAIT",
	}).Where("source_id = ? AND owner_id = ? AND device_id = ?",
		op.SourceID, uid, op.DeviceID).Take(&binding).Error; err != nil ||
		binding.RootID != op.RootID ||
		binding.RootFingerprint != op.RootFingerprint {
		return op, deny
	}

	parentID := targetID
	if op.TargetParentID != nil {
		parentID = *op.TargetParentID
	} else {
		var file meta.Node
		if err := tx.WithContext(ctx).Clauses(clause.Locking{
			Strength: "SHARE", Options: "NOWAIT",
		}).Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*op.TargetNodeID, uid, meta.NodeTypeFile).Take(&file).Error; err != nil ||
			file.ParentID == nil || file.Revision != op.ExpectedRevision {
			return op, deny
		}
		parentID = *file.ParentID
	}
	if requireLocalPushCommonDescendantDirTx(
		tx.WithContext(ctx), uid, op.SourceTargetID, parentID,
	) != nil {
		return op, deny
	}
	return op, nil
}
