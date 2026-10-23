package api

import (
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type localPushCommonAdmitRequest struct {
	OperationID      string  `json:"operation_id"`
	ResumeKey        string  `json:"resume_key"`
	ContentSHA256    string  `json:"sha256"`
	Size             int64   `json:"size"`
	ParentID         *uint64 `json:"parent_id,omitempty"`
	NodeID           *uint64 `json:"node_id,omitempty"`
	Name             string  `json:"name,omitempty"`
	ExpectedRevision uint64  `json:"expected_revision,omitempty"`
}

type localPushCommonBindRequest struct {
	OperationID     string `json:"operation_id"`
	ResumeKey       string `json:"resume_key"`
	UploadSessionID string `json:"upload_session_id"`
}

func validLocalPushCommonAdmitRequest(req localPushCommonAdmitRequest, maxBytes int64) bool {
	if maxBytes < 0 || req.Size < 0 || req.Size > maxBytes ||
		!validLocalPushCommonReceiptSelector(localPushCommonReceiptSelector{
			OperationID: req.OperationID, ResumeKey: req.ResumeKey,
		}) || (!validSHA256(req.ContentSHA256) || req.ContentSHA256 != strings.ToLower(req.ContentSHA256)) ||
		(req.ParentID == nil) == (req.NodeID == nil) {
		return false
	}
	if req.ParentID != nil {
		return *req.ParentID != 0 && req.NodeID == nil &&
			req.ExpectedRevision == 0 && meta.ValidateName(req.Name) == nil
	}
	return req.NodeID != nil && *req.NodeID != 0 &&
		req.ParentID == nil && req.ExpectedRevision != 0 && req.Name == ""
}

func sameLocalPushCommonAdmit(
	op meta.LocalPushCommonUploadOperation, owner meta.User, source meta.Source,
	proof localSourceExecutorProof, fingerprint string, req localPushCommonAdmitRequest,
) bool {
	return source.TargetNodeID != nil &&
		op.OperationID == req.OperationID && op.OwnerID == owner.ID &&
		op.OwnerSession == owner.SessionVersion && op.DeviceID == proof.DeviceID &&
		op.RootID == proof.RootID && op.RootFingerprint == fingerprint &&
		op.SourceID == source.ID && op.SourceRevision == source.Revision &&
		op.SourceTargetID == *source.TargetNodeID && op.ResumeKey == req.ResumeKey &&
		op.ContentSHA256 == req.ContentSHA256 && op.TotalSize == req.Size &&
		((req.ParentID != nil && op.TargetParentID != nil &&
			*op.TargetParentID == *req.ParentID && op.TargetNodeID == nil &&
			op.TargetName == req.Name && op.ExpectedRevision == 0) ||
			(req.NodeID != nil && op.TargetNodeID != nil &&
				*op.TargetNodeID == *req.NodeID && op.TargetParentID == nil &&
				op.TargetName == "" && op.ExpectedRevision == req.ExpectedRevision))
}

// Legacy first-file quarantine cannot be retired just because a generic
// upload returns an ACK. Source-wide SQL scope locks are held by the caller;
// any original Stage/Operation/terminal blocks the new route until an explicit
// audited migration. Agent-local secret markers require their own migration.
func requireNoLegacyLocalPushClaimsTx(tx *gorm.DB, sourceID uint64) error {
	if tx == nil || sourceID == 0 {
		return errLocalPushCommonUploadUnavailable
	}
	// A historical first-file claim can outlive another legacy table after
	// expiry, partial cleanup, ACK loss or a crash. Checking only the Stage
	// and OperationIntent would miss the still-persisted CAS/SQL write proof.
	// No legacy claim is retired by the common uploader; migration is separate.
	for _, model := range []any{
		&meta.LocalPushStaging{},
		&meta.LocalPushOperationIntent{},
		&meta.LocalPushOperationTerminalReceipt{},
		&meta.LocalPushOperationStageBinding{},
		&meta.LocalPushFirstLeafOperationCommit{},
		&meta.LocalPushFileTerminal{},
		&meta.LocalPushNativeTerminalChallenge{},
		&meta.LocalPushCASPrepareIntent{},
		&meta.LocalPushQuotaHold{},
		&meta.LocalPushFirstDirectoryChallenge{},
	} {
		var count int64
		if err := tx.Model(model).Where("source_id = ?", sourceID).
			Count(&count).Error; err != nil || count != 0 {
			return errLocalPushCommonUploadUnavailable
		}
	}
	return nil
}

// admitBoundLocalPushCommonUpload records only a stable, private, authorized
// Operation intent. It does not write CAS, create Node/FileVersion, launch a
// runner, retire legacy claims or authorize the generic UploadSession by itself.
// Retry with the EXACT original identity returns its original row.
func (s *Server) admitBoundLocalPushCommonUpload(
	c *gin.Context, sourceID, revision uint64, req localPushCommonAdmitRequest,
) (meta.LocalPushCommonUploadOperation, error) {
	var zero meta.LocalPushCommonUploadOperation
	deny := errLocalPushCommonUploadUnavailable
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		c.Request.Context().Err() != nil || sourceID == 0 || revision == 0 ||
		!validLocalPushCommonAdmitRequest(req, s.MaxUploadBytes) {
		return zero, deny
	}
	proof, ok := localPushStageProof(c)
	if !ok || proof.SourceRevision != revision {
		return zero, deny
	}
	var selected meta.LocalPushCommonUploadOperation
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		owner, source, fingerprint, err := s.localPushOperationIntentScopeTx(
			tx, c, sourceID, revision, proof)
		if err != nil || source.TargetNodeID == nil {
			return deny
		}
		if err := requireNoLegacyLocalPushClaimsTx(tx, source.ID); err != nil {
			return deny
		}
		var existing meta.LocalPushCommonUploadOperation
		read := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "NOWAIT"}).
			Where("operation_id = ?", req.OperationID).Take(&existing).Error
		if read == nil {
			if !sameLocalPushCommonAdmit(existing, owner, source, proof, fingerprint, req) {
				return deny
			}
			selected = existing
			return c.Request.Context().Err()
		}
		if !errors.Is(read, gorm.ErrRecordNotFound) {
			return deny
		}
		targetRoot := *source.TargetNodeID
		if req.ParentID != nil {
			if *req.ParentID != targetRoot {
				return deny
			}
		} else {
			var node meta.Node
			if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
				Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
					*req.NodeID, owner.ID, meta.NodeTypeFile).Take(&node).Error; err != nil ||
				node.ParentID == nil || *node.ParentID != targetRoot ||
				node.Revision != req.ExpectedRevision {
				return deny
			}
		}
		row := meta.LocalPushCommonUploadOperation{
			OperationID: req.OperationID, OwnerID: owner.ID,
			OwnerSession: owner.SessionVersion, DeviceID: proof.DeviceID,
			RootID: proof.RootID, RootFingerprint: fingerprint,
			SourceID: source.ID, SourceRevision: source.Revision,
			SourceTargetID: targetRoot, ResumeKey: req.ResumeKey,
			TargetParentID: req.ParentID, TargetNodeID: req.NodeID,
			TargetName: req.Name, ExpectedRevision: req.ExpectedRevision,
			ContentSHA256: req.ContentSHA256, TotalSize: req.Size,
			State: meta.LocalPushCommonUploadReserved,
		}
		if err := tx.Create(&row).Error; err != nil {
			return deny
		}
		selected = row
		return c.Request.Context().Err()
	})
	if err != nil {
		return zero, deny
	}
	return selected, nil
}

// bindBoundLocalPushCommonUpload attaches one already-created ordinary upload
// session to the original authorized Operation, before the ordinary finalize.
// NOWAIT avoids a cross-lock deadlock if a generic finalizer already holds the
// Session lock and is checking current Source/Device/Root authority.
func (s *Server) bindBoundLocalPushCommonUpload(
	c *gin.Context, sourceID, revision uint64, req localPushCommonBindRequest,
) (meta.LocalPushCommonUploadOperation, error) {
	var zero meta.LocalPushCommonUploadOperation
	deny := errLocalPushCommonUploadUnavailable
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		c.Request.Context().Err() != nil || sourceID == 0 || revision == 0 ||
		!validLocalPushCommonReceiptSelector(localPushCommonReceiptSelector{
			OperationID: req.OperationID, ResumeKey: req.ResumeKey,
		}) || !validLocalPushPrepareOperationUUID(req.UploadSessionID) {
		return zero, deny
	}
	proof, ok := localPushStageProof(c)
	if !ok || proof.SourceRevision != revision {
		return zero, deny
	}
	var bound meta.LocalPushCommonUploadOperation
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		owner, source, fingerprint, err := s.localPushOperationIntentScopeTx(
			tx, c, sourceID, revision, proof)
		if err != nil || source.TargetNodeID == nil {
			return deny
		}
		if err := requireNoLegacyLocalPushClaimsTx(tx, source.ID); err != nil {
			return deny
		}
		var session meta.UploadSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "NOWAIT"}).
			Where("id = ? AND owner_id = ?", req.UploadSessionID, owner.ID).
			Take(&session).Error; err != nil {
			return deny
		}
		var op meta.LocalPushCommonUploadOperation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "NOWAIT"}).
			Where("operation_id = ? AND source_id = ? AND owner_id = ?",
				req.OperationID, source.ID, owner.ID).Take(&op).Error; err != nil {
			return deny
		}
		if op.OwnerSession != owner.SessionVersion ||
			op.DeviceID != proof.DeviceID || op.RootID != proof.RootID ||
			op.RootFingerprint != fingerprint || op.SourceRevision != revision ||
			op.SourceTargetID != *source.TargetNodeID ||
			op.ResumeKey != req.ResumeKey ||
			op.State != meta.LocalPushCommonUploadReserved &&
				op.State != meta.LocalPushCommonUploadBound ||
			op.CommittedAt != nil || op.ResultNodeID != nil ||
			op.ResultNodeRevision != 0 ||
			session.Status != meta.UploadStatusActive ||
			!time.Now().Before(session.ExpiresAt) ||
			session.ResumeKey != req.ResumeKey || session.OwnerID != owner.ID ||
			session.ConflictPolicy != meta.UploadConflictPolicyFail ||
			session.SHA256 != op.ContentSHA256 || session.TotalSize != op.TotalSize ||
			(op.TargetParentID == nil) == (op.TargetNodeID == nil) {
			return deny
		}
		if op.TargetParentID != nil {
			if *op.TargetParentID != *source.TargetNodeID ||
				session.ParentID == nil || *session.ParentID != *op.TargetParentID ||
				session.NodeID != nil || session.Name != op.TargetName ||
				op.ExpectedRevision != 0 {
				return deny
			}
		} else if session.NodeID == nil ||
			*session.NodeID != *op.TargetNodeID ||
			session.ParentID != nil ||
			session.ExpectedRevision != op.ExpectedRevision ||
			op.ExpectedRevision == 0 {
			return deny
		}
		if op.State == meta.LocalPushCommonUploadBound {
			if op.UploadSessionID == nil || *op.UploadSessionID != session.ID {
				return deny
			}
			bound = op
			return c.Request.Context().Err()
		}
		if op.UploadSessionID != nil {
			return deny
		}
		// A Source target may have been replaced after original admission.
		// Rechecking current matching direct-child Node at bind is required
		// even though ordinary Finalize rechecks again under its own locks.
		if op.TargetNodeID != nil {
			var node meta.Node
			if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
				Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
					*op.TargetNodeID, owner.ID, meta.NodeTypeFile).
				Take(&node).Error; err != nil || node.ParentID == nil ||
				*node.ParentID != op.SourceTargetID ||
				node.Revision != op.ExpectedRevision {
				return deny
			}
		}
		changed := tx.Model(&meta.LocalPushCommonUploadOperation{}).
			Where("operation_id = ? AND owner_id = ? AND state = ? AND upload_session_id IS NULL",
				op.OperationID, owner.ID, meta.LocalPushCommonUploadReserved).
			Updates(map[string]any{
				"state":             meta.LocalPushCommonUploadBound,
				"upload_session_id": session.ID,
			})
		if changed.Error != nil || changed.RowsAffected != 1 {
			return deny
		}
		op.State = meta.LocalPushCommonUploadBound
		op.UploadSessionID = &session.ID
		bound = op
		return c.Request.Context().Err()
	})
	if err != nil {
		return zero, deny
	}
	return bound, nil
}
