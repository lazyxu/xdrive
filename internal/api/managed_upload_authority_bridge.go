package api

import (
	"context"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// A Pull worker's signed SourceRun grants and a native Local Push device's
// durable Operation are independent authorities. Never let a generic Owner
// bearer or a mere lp2_ prefix become a managed-tree writer.
func requireSourceRunOrLocalPushTargetTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, ownerID, nodeID uint64, req uploadInitRequest,
) error {
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

func requireSourceRunOrLocalPushFinalizeTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, session meta.UploadSession, nodeID uint64,
) error {
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
func requireUploadSessionReadAuthorityTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, session meta.UploadSession,
) error {
	if tx == nil || c == nil || session.ID == "" || session.OwnerID == 0 ||
		!sourceRunUploadSessionMatches(c, session) {
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
	if session.Status != meta.UploadStatusActive {
		return errManagedSourceWriteDenied
	}
	return requireUploadSessionReadAuthorityTx(ctx, tx, c, session)
}
