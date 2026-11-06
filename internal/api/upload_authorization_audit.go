package api

import (
	"errors"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const uploadAuthorizationAuditAction = "upload.authorization"

// Only opaque account-scoped identifiers enter audit metadata. Never persist
// credentials, Root fingerprints, resume keys, local paths or photo names.
func uploadAuthorizationAuditMetadata(phase string, session meta.UploadSession) map[string]any {
	writer := "owner"
	switch {
	case session.SourceID != 0 && session.SourceDeviceID != "":
		writer = "device_push"
	case session.SourceRunID != "":
		writer = "pull_run"
	case strings.HasPrefix(session.ResumeKey, "lp2_"):
		writer = "local_push"
	case session.ShareID != nil:
		writer = "share"
	}
	metadata := map[string]any{"phase": phase, "writer": writer}
	if session.OwnerID != 0 {
		metadata["owner_id"] = session.OwnerID
	}
	if session.SourceID != 0 {
		metadata["source_id"] = session.SourceID
		metadata["source_revision"] = session.SourceRevision
	}
	if session.SourceDeviceID != "" {
		metadata["device_id"] = session.SourceDeviceID
	}
	if session.SourceTargetID != 0 {
		metadata["target_node_id"] = session.SourceTargetID
	}
	if session.SourceRunID != "" {
		metadata["source_run_id"] = session.SourceRunID
	}
	if session.ShareID != nil {
		metadata["share_id"] = *session.ShareID
	}
	return metadata
}

// A successful admission record commits in precisely the same SQL transaction
// as its UploadSession, UploadPart, CAS/Node or abort mutation. Audit failure
// fails closed: no committed writer without its durable authorization record.
func recordUploadAuthorizationSuccessTx(tx *gorm.DB, c *gin.Context, phase string, session meta.UploadSession) error {
	return recordUploadAuthorizationSuccessAsTx(tx, c, phase, "", session)
}

func recordUploadAuthorizationSuccessAsTx(
	tx *gorm.DB, c *gin.Context, phase, writer string, session meta.UploadSession,
) error {
	if tx == nil || c == nil || session.ID == "" {
		return errManagedSourceWriteDenied
	}
	metadata := uploadAuthorizationAuditMetadata(phase, session)
	if writer != "" {
		metadata["writer"] = writer
	}
	event := auditEventFromContext(c, uploadAuthorizationAuditAction,
		"upload_session", session.ID, "", auditpkg.ResultSuccess, metadata)
	return recordAuditTx(tx, event)
}

// The Local Push original-operation ledger is a second durable writer
// boundary, independent of the short-lived generic UploadSession. Audit its
// admission, bind/rebind and private receipt inside the same SQL transaction.
func localPushOperationAuditMetadata(phase string, op meta.LocalPushCommonUploadOperation) map[string]any {
	metadata := map[string]any{
		"phase": phase, "writer": "local_push",
		"owner_id": op.OwnerID, "source_id": op.SourceID,
		"source_revision": op.SourceRevision, "device_id": op.DeviceID,
		"target_node_id": op.SourceTargetID, "state": op.State,
	}
	return metadata
}

func recordUploadAuthorizationOperationSuccessTx(
	tx *gorm.DB, c *gin.Context, phase string, op meta.LocalPushCommonUploadOperation,
) error {
	if tx == nil || c == nil || op.OperationID == "" || op.OwnerID == 0 ||
		op.SourceID == 0 || op.DeviceID == "" || op.SourceTargetID == 0 {
		return errLocalPushCommonUploadUnavailable
	}
	event := auditEventFromContext(c, uploadAuthorizationAuditAction,
		"local_push_operation", op.OperationID, "", auditpkg.ResultSuccess,
		localPushOperationAuditMetadata(phase, op))
	return recordAuditTx(tx, event)
}

func (s *Server) recordUploadAuthorizationOperationFailure(
	c *gin.Context, phase string, sourceID, revision uint64,
	proof localSourceExecutorProof, err error,
) {
	if s == nil || s.DB == nil || c == nil || err == nil ||
		(!errors.Is(err, errLocalPushCommonUploadUnavailable) &&
			!errors.Is(err, errManagedSourceWriteDenied)) {
		return
	}
	metadata := map[string]any{
		"phase": phase, "writer": "local_push", "reason": "permission_denied",
		"source_id": sourceID, "source_revision": revision,
	}
	if proof.DeviceID != "" {
		metadata["device_id"] = proof.DeviceID
	}
	event := auditEventFromContext(c, uploadAuthorizationAuditAction,
		"source", strconv.FormatUint(sourceID, 10), "", auditpkg.ResultFailure, metadata)
	s.recordAuditBestEffort(c, event)
}

// Denials cannot be logged in their failed write transaction: that would roll
// back the denial evidence. The request remains denied even if the best-effort
// denial audit is temporarily unavailable.
func (s *Server) recordUploadAuthorizationFailure(c *gin.Context, phase string, session meta.UploadSession, err error) {
	if s == nil || s.DB == nil || c == nil || err == nil ||
		(!errors.Is(err, errManagedSourceWriteDenied) &&
			!errors.Is(err, errSynologyPushAuthority) &&
			!errors.Is(err, errShareUploadDenied) &&
			!errors.Is(err, errLocalPushCommonUploadUnavailable)) {
		return
	}
	metadata := uploadAuthorizationAuditMetadata(phase, session)
	metadata["reason"] = "permission_denied"
	event := auditEventFromContext(c, uploadAuthorizationAuditAction,
		"upload_session", session.ID, "", auditpkg.ResultFailure, metadata)
	if session.ID == "" && session.SourceID != 0 {
		event.TargetType = "source"
		event.TargetID = strconv.FormatUint(session.SourceID, 10)
	}
	s.recordAuditBestEffort(c, event)
}

// Workers such as instant CAS reuse do not carry a Gin request, but they still
// record the same writer/Source/Target tuple inside their canonical SQL write.
func recordUploadAuthorizationSystemTx(tx *gorm.DB, phase string, session meta.UploadSession) error {
	if tx == nil || session.ID == "" || session.OwnerID == 0 {
		return errManagedSourceWriteDenied
	}
	ownerID := session.OwnerID
	return recordAuditTx(tx, auditpkg.Event{
		ActorUserID: &ownerID,
		Action:      uploadAuthorizationAuditAction,
		TargetType: "upload_session",
		TargetID:   session.ID,
		Result:     auditpkg.ResultSuccess,
		Metadata:   uploadAuthorizationAuditMetadata(phase, session),
	})
}
