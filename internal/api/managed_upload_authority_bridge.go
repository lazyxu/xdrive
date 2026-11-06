package api

import (
	"context"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// A single UploadSession belongs to exactly one writer class. A row with
// conflicting device-Source, SourceRun or Share claims is quarantined even if
// its Owner credentials are otherwise valid. A Local Push lp2_ claim is also
// never a second capability layered on a worker or public Share grant.
func mixedUploadSessionWriterClaims(session meta.UploadSession) bool {
	if unboundSourceUploadSession(session) {
		return true
	}
	if session.SourceID != 0 {
		return session.SourceRunID != "" || session.ShareID != nil
	}
	if session.ShareID != nil && session.SourceRunID != "" {
		return true
	}
	return strings.HasPrefix(session.ResumeKey, "lp2_") &&
		(session.SourceRunID != "" || session.ShareID != nil)
}

// Do not fall back to generic Owner authority when the request identifies a
// DSM Source but omits the canonical SourceID in its upload payload. Device
// identity and Root headers alone never authorize an ordinary upload.
func conflictingUploadRequestWriter(c *gin.Context, sourceID uint64) bool {
	if c == nil {
		return true
	}
	if sourceID != 0 {
		if _, scoped := currentSourceRunScope(c); scoped {
			return true
		}
		if _, guest := c.Get("xdriveShareUploadID"); guest {
			return true
		}
		return false
	}
	if c.Request == nil {
		return false // direct transaction helpers in tests have no HTTP request
	}
	return strings.TrimSpace(c.GetHeader("X-XDrive-Synology-Source-ID")) != "" ||
		strings.TrimSpace(c.GetHeader("X-XDrive-Synology-Source-Revision")) != ""
}

// A Pull worker's signed SourceRun grants and a native Local Push device's
// durable Operation are independent authorities. Never let a generic Owner
// bearer or a mere lp2_ prefix become a managed-tree writer.
func requireSourceRunOrLocalPushTargetTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, ownerID, nodeID uint64, req uploadInitRequest,
) error {
	if conflictingUploadRequestWriter(c, req.SourceID) {
		return errManagedSourceWriteDenied
	}
	if _, photos := currentIOSPhotoManagedUploadScope(c); photos {
		if _, run := currentSourceRunScope(c); run {
			return errManagedSourceWriteDenied
		}
		return requireIOSPhotoManagedUploadTx(ctx, tx, c, ownerID, nodeID, req)
	}
	if req.SourceID != 0 {
		return requireSynologyPushUploadTargetTx(ctx, tx, c, ownerID, nodeID, req)
	}
	if _, scoped := currentSourceRunScope(c); scoped {
		return requireSourceRunOrOrdinaryTargetTx(ctx, tx, c, ownerID, nodeID)
	}
	return requireOrdinaryOrAdmittedLocalPushTargetTx(ctx, tx, ownerID, nodeID, req)
}

// A Source-less upload must have no residual managed Push identity. Reject
// half-bound/legacy sessions rather than silently giving them Owner, Local
// Push or SourceRun rights at a durable upload mutation boundary.
func unboundSourceUploadSession(session meta.UploadSession) bool {
	return session.SourceID == 0 &&
		(session.SourceRevision != 0 || session.SourceDeviceID != "" ||
			session.SourceTargetID != 0 || session.SourceRootID != "" ||
			session.SourceRootFingerprint != "")
}

func requireSourceRunOrLocalPushFinalizeTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, session meta.UploadSession, nodeID uint64,
) error {
	if mixedUploadSessionWriterClaims(session) ||
		conflictingUploadRequestWriter(c, session.SourceID) {
		return errManagedSourceWriteDenied
	}
	if _, photos := currentIOSPhotoManagedUploadScope(c); photos {
		if _, run := currentSourceRunScope(c); run {
			return errManagedSourceWriteDenied
		}
		return requireIOSPhotoManagedFinalizeTx(ctx, tx, c, session, nodeID)
	}
	if session.SourceID != 0 {
		// Source-backed sessions must use their native, platform-specific proof.
		// A SourceID alone never conveys a generic Owner write capability.
		if _, photos := currentIOSPhotoManagedUploadScope(c); photos {
			return requireIOSPhotoManagedFinalizeTx(ctx, tx, c, session, nodeID)
		}
		return requireSynologyPushUploadSessionTx(ctx, tx, c, session)
	}
	if _, scoped := currentSourceRunScope(c); scoped {
		return requireSourceRunOrOrdinaryTargetTx(ctx, tx, c, session.OwnerID, nodeID)
	}
	return requireOrdinaryOrBoundLocalPushFinalizeTx(ctx, tx, session, nodeID)
}

// requireUploadSessionReadAuthorityTx protects session metadata and receipt
// reads. A session UUID is not a bearer credential: the live platform grant
// must still own the exact Source/Device/Target or operation at read time.
func (s *Server) requireUploadSessionReadAuthorityTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, session meta.UploadSession,
) error {
	if tx == nil || c == nil || session.ID == "" || session.OwnerID == 0 {
		return errManagedSourceWriteDenied
	}
	// Re-read the durable row in this transaction; never authorize a stale
	// preflight copy after concurrent abort, finalization or identity changes.
	var current meta.UploadSession
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ?", session.ID, session.OwnerID).
		Take(&current).Error; err != nil {
		return errManagedSourceWriteDenied
	}
	session = current
	if mixedUploadSessionWriterClaims(session) ||
		conflictingUploadRequestWriter(c, session.SourceID) {
		return errManagedSourceWriteDenied
	}
	if !sourceRunUploadSessionMatches(c, session) {
		return errManagedSourceWriteDenied
	}
	if session.SourceID != 0 {
		if _, photos := currentIOSPhotoManagedUploadScope(c); photos {
			return requireIOSPhotoManagedSessionTx(ctx, tx, c, session)
		}
		return requireSynologyPushUploadSessionTx(ctx, tx, c, session)
	}
	if _, photos := currentIOSPhotoManagedUploadScope(c); photos {
		return errManagedSourceWriteDenied
	}

	// Public Share upload is a distinct revocable grant, never Owner authority.
	if session.ShareID != nil {
		granted, present := c.Get("xdriveShareUploadID")
		shareID, valid := granted.(uint64)
		if !present || !valid || shareID == 0 || shareID != *session.ShareID ||
			session.ParentID == nil || session.NodeID != nil ||
			session.ConflictPolicy != meta.UploadConflictPolicyKeepBoth {
			return errManagedSourceWriteDenied
		}
		_, err := s.publicShareUploadAdmissionTx(ctx, tx, shareID, session.OwnerID, *session.ParentID)
		return err
	}
	if _, present := c.Get("xdriveShareUploadID"); present {
		return errManagedSourceWriteDenied
	}

	nodeID := uint64(0)
	if session.NodeID != nil {
		nodeID = *session.NodeID
	} else if session.ParentID != nil {
		nodeID = *session.ParentID
	}
	if nodeID == 0 {
		return errManagedSourceWriteDenied
	}
	if session.SourceRunID != "" {
		return trustedSourceRunTargetTx(ctx, tx, c, session.OwnerID, nodeID, true)
	}
	req := uploadInitRequest{
		ParentID: session.ParentID, NodeID: session.NodeID,
		Name: session.Name, Size: session.TotalSize, SHA256: session.SHA256,
		ResumeKey: session.ResumeKey, ExpectedRevision: session.ExpectedRevision,
		ConflictPolicy: session.ConflictPolicy,
	}
	if strings.HasPrefix(session.ResumeKey, "lp2_") {
		_, err := admittedManagedLocalPushOperationTx(ctx, tx, session.OwnerID, nodeID, req)
		return err
	}
	return requireOrdinarySourceTargetTx(ctx, tx, session.OwnerID, nodeID)
}

// requireUploadChunkAuthorityTx is invoked by the ACTUAL UploadPart SQL
// transaction and resumable reservation transaction after the UploadSession
// row lock. It reuses the same live authority rules as readback, and adds the
// active-session condition before any durable part/quota mutation.
func (s *Server) requireUploadChunkAuthorityTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, session meta.UploadSession,
) error {
	if tx == nil || c == nil || session.ID == "" || session.OwnerID == 0 {
		return errManagedSourceWriteDenied
	}
	var current meta.UploadSession
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ?", session.ID, session.OwnerID).
		Take(&current).Error; err != nil || current.Status != meta.UploadStatusActive {
		return errManagedSourceWriteDenied
	}
	return s.requireUploadSessionReadAuthorityTx(ctx, tx, c, current)
}
