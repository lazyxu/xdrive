package api

import (
	"context"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func uploadRequestTargetID(req uploadInitRequest) uint64 {
	if req.NodeID != nil { return *req.NodeID }
	if req.ParentID != nil { return *req.ParentID }
	return 0
}

func uploadSessionTargetID(session meta.UploadSession) uint64 {
	if session.NodeID != nil { return *session.NodeID }
	if session.ParentID != nil { return *session.ParentID }
	return 0
}

func authorizeUploadTargetTx(ctx context.Context, tx *gorm.DB, c *gin.Context, ownerID, targetID uint64, req uploadInitRequest, session *meta.UploadSession) error {
	if tx == nil || session == nil || targetID == 0 { return errManagedSourceWriteDenied }
	if err := requireSourceRunOrLocalPushTargetTx(ctx, tx, c, ownerID, targetID, req); err != nil { return err }
	if photo, ok := currentIOSPhotoManagedUploadScope(c); ok {
		session.SourceID, session.SourceRevision = photo.sourceID, photo.sourceRevision
		session.SourceDeviceID, session.SourceTargetID = photo.deviceID, photo.targetID
	}
	if req.SourceID != 0 {
		session.SourceID, session.SourceRevision = req.SourceID, req.SourceRevision
		session.SourceDeviceID = strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID"))
		session.SourceRootID, session.SourceRootFingerprint = req.SourceRootID, req.SourceRootFingerprint
		var source meta.Source
		if err := tx.Select("target_node_id").Where("id = ? AND owner_id = ?", req.SourceID, ownerID).Take(&source).Error; err != nil || source.TargetNodeID == nil {
			return errManagedSourceWriteDenied
		}
		session.SourceTargetID = *source.TargetNodeID
	}
	return nil
}

func authorizeUploadSessionWriteTx(ctx context.Context, tx *gorm.DB, c *gin.Context, session meta.UploadSession) error {
	targetID := uploadSessionTargetID(session)
	if tx == nil || targetID == 0 || session.ID == "" || session.Status != meta.UploadStatusActive {
		return errManagedSourceWriteDenied
	}
	return requireSourceRunOrLocalPushFinalizeTx(ctx, tx, c, session, targetID)
}

func (s *Server) verifyUploadSessionAuthorization(c *gin.Context, session meta.UploadSession) error {
	if s == nil || s.DB == nil || c == nil || c.Request == nil { return errManagedSourceWriteDenied }
	if session.Status != meta.UploadStatusActive { return nil }
	return s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		return authorizeUploadSessionWriteTx(c.Request.Context(), tx, c, session)
	})
}

func uploadAuthorizationEvent(tx *gorm.DB, c *gin.Context, session meta.UploadSession, operation string, targetID uint64, result string) audit.Event {
	actorID := session.OwnerID
	actorUsername, actorRole := "upload-client", "user"
	authorization := "owner"
	sourceID, deviceID := session.SourceID, session.SourceDeviceID
	sourceRevision, sourceRunID := session.SourceRevision, session.SourceRunID
	if session.ShareID != nil { authorization = "share" }
	if c != nil {
		if owner, ok := currentUser(c); ok { actorUsername, actorRole = owner.Username, owner.Role }
		if photo, ok := currentIOSPhotoManagedUploadScope(c); ok {
			authorization = "ios_device"
			sourceID, deviceID, sourceRevision = photo.sourceID, photo.deviceID, photo.sourceRevision
		}
		if id, proof, ok := currentSynologySourceProof(c); ok {
			authorization = "synology_device"
			sourceID, deviceID, sourceRevision = id, proof.DeviceID, proof.SourceRevision
		}
		if scope, ok := currentSourceRunScope(c); ok {
			authorization = "source_run"
			sourceID, sourceRunID = scope.sourceID, scope.runID
		}
		if raw, ok := c.Get(localSourceExecutorContextKey); ok {
			if proof, valid := raw.(localSourceExecutorProof); valid && proof.DeviceID != "" {
				authorization, deviceID = "local_device", proof.DeviceID
			}
		}
	}
	if tx != nil && strings.HasPrefix(session.ResumeKey, "lp2_") {
		var op meta.LocalPushCommonUploadOperation
		if err := tx.Select("source_id", "device_id", "source_revision").
			Where("owner_id = ? AND resume_key = ?", session.OwnerID, session.ResumeKey).
			Take(&op).Error; err == nil {
			authorization = "local_device"
			sourceID, deviceID, sourceRevision = op.SourceID, op.DeviceID, op.SourceRevision
		}
	}
	if c == nil && authorization != "owner" && authorization != "share" {
		actorUsername, actorRole = "native-device", "device"
	}
	metadata := map[string]any{"operation": operation, "decision": result, "authorization": authorization, "target_node_id": targetID}
	if sourceID != 0 { metadata["source_id"] = sourceID }
	if deviceID != "" { metadata["device_id"] = deviceID }
	if sourceRevision != 0 { metadata["source_revision"] = sourceRevision }
	if sourceRunID != "" { metadata["source_run_id"] = sourceRunID }
	event := audit.Event{
		ActorUserID: &actorID, ActorUsername: actorUsername, ActorRole: actorRole,
		Action: audit.ActionUploadAuthorization, TargetType: "upload_session",
		TargetID: session.ID, TargetLabel: operation, Result: result, Metadata: metadata,
	}
	if c != nil && c.Request != nil {
		event.RequestID, event.IPAddress = requestIDFromContext(c), c.ClientIP()
	}
	return event
}

func recordUploadAuthorizationTx(tx *gorm.DB, c *gin.Context, session meta.UploadSession, operation string, targetID uint64) error {
	if tx == nil || session.ID == "" { return audit.RecordTx(tx, audit.Event{}) }
	return audit.RecordTx(tx, uploadAuthorizationEvent(tx, c, session, operation, targetID, audit.ResultSuccess))
}

func recordUploadAuthorizationFailure(db *gorm.DB, c *gin.Context, session meta.UploadSession, operation string, targetID uint64) {
	if db == nil || session.ID == "" { return }
	_ = audit.Record(db, uploadAuthorizationEvent(nil, c, session, operation, targetID, audit.ResultFailure))
}
