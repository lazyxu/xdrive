package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const iosPhotoManagedContextKey = "xdriveIOSPhotoManagedUploadScope"

type iosPhotoManagedUploadScope struct {
	ownerID  uint64
	deviceID       string
	sourceID       uint64
	sourceRevision uint64
	targetID       uint64
}

func currentIOSPhotoManagedUploadScope(c *gin.Context) (iosPhotoManagedUploadScope, bool) {
	if c == nil {
		return iosPhotoManagedUploadScope{}, false
	}
	raw, ok := c.Get(iosPhotoManagedContextKey)
	scope, valid := raw.(iosPhotoManagedUploadScope)
	return scope, ok && valid && scope.ownerID != 0 &&
		scope.sourceID != 0 && scope.sourceRevision != 0 && scope.targetID != 0 && scope.deviceID != ""
}

// Authenticated native iOS Owner + independently verified device. This is a
// narrow PhotoKit-original upload alias, never a Desktop local_folder writer
// or an elevation of the iOS identity-only credential to generic Files.
// Foreground: current verified Owner JWT + independently registered iPhone.
// Background: independently revocable, current Server-validated BG grant +
// second native device secret, with the SAME exact Source/Node binding.
// A BG grant never becomes an ordinary /nodes or local_folder bearer.
func (s *Server) iosPhotoManagedAuthorizedScope(c *gin.Context) (iosPhotoManagedUploadScope, bool) {
	grant, background := iosPhotoBackgroundGrantFromContext(c)
	ownerID := uint64(0)
	if background {
		if !iosPhotoGrantHasManagedTarget(grant) {
			fail(c, http.StatusForbidden, "legacy owner-root grant cannot write managed photos")
			return iosPhotoManagedUploadScope{}, false
		}
		ownerID = grant.OwnerID
	} else {
		owner, ok := currentUser(c)
		if !ok || owner.ID == 0 || owner.DisabledAt != nil || owner.MustChangePassword {
			fail(c, http.StatusForbidden, "current owner required for ios photo upload")
			return iosPhotoManagedUploadScope{}, false
		}
		ownerID = owner.ID
	}
	var out iosPhotoManagedUploadScope
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		device, err := iosPhotoDestinationDeviceTx(c, tx, ownerID)
		if err != nil {
			return err
		}
		source, target, err := iosPhotoDestinationBindingTx(tx, device)
		if err != nil {
			return err
		}
		if background && (source.ID != *grant.SourceID ||
			target.ID != *grant.TargetNodeID ||
			grant.DeviceID != device.ID) {
			return errIOSPhotoDestinationDenied
		}
		out = iosPhotoManagedUploadScope{
			ownerID: ownerID, deviceID: device.ID, sourceID: source.ID,
			sourceRevision: source.Revision, targetID: target.ID,
		}
		return nil
	})
	if err != nil || out.targetID == 0 {
		fail(c, http.StatusForbidden, "verified ios photo managed destination required")
		return iosPhotoManagedUploadScope{}, false
	}
	// Only a separately validated BG grant injects an Owner scope for the
	// existing CAS engine, never a generic Auth JWT or /nodes route.
	if background {
		c.Set("userID", ownerID)
	}
	c.Set(iosPhotoManagedContextKey, out)
	c.Header("Cache-Control", "private, no-store")
	return out, true
}

func validIOSPhotoManagedUploadInit(req uploadInitRequest, scope iosPhotoManagedUploadScope) bool {
	return scope.targetID != 0 && req.ParentID != nil &&
		*req.ParentID == scope.targetID && req.NodeID == nil &&
		iosBackgroundOriginalNameValid(req.Name) &&
		req.ConflictPolicy == meta.UploadConflictPolicyFail &&
		req.ExpectedRevision == 0 && req.MD5 == "" &&
		req.SourceID == 0 && req.SourceRevision == 0 &&
		req.SourceRootID == "" && req.SourceRootFingerprint == "" &&
		req.Size > 0 && req.Size <= iosBackgroundOriginalMaxBytes &&
		req.ChunkSize == defaultUploadChunkSize &&
		req.SHA256 == strings.ToLower(req.SHA256) &&
		validSHA256(req.SHA256) &&
		validIOSUploadResumeLookupKey(req.ResumeKey) &&
		len(req.ChunkSHA256) == 0
}

// Called by the actual CAS UploadSession create and finalize transaction.
// Re-check authorization even after route admission: Source can be revoked,
// moved or replaced between HTTP entry and durable SQL commit.
func requireIOSPhotoManagedUploadTx(ctx context.Context, tx *gorm.DB,
	c *gin.Context, ownerID, targetID uint64, req uploadInitRequest) error {
	scope, ok := currentIOSPhotoManagedUploadScope(c)
	if !ok || ownerID != scope.ownerID || targetID != scope.targetID ||
		!validIOSPhotoManagedUploadInit(req, scope) ||
		req.NodeID != nil {
		return errManagedSourceWriteDenied
	}
	// Recheck BG grant revocation, Owner session generation and precise
	// Source/Target INSIDE the same transaction as CAS session creation or
	// Finalize, not only at HTTP middleware admission.
	if grant, background := iosPhotoBackgroundGrantFromContext(c); background {
		if !iosPhotoGrantHasManagedTarget(grant) ||
			grant.OwnerID != ownerID || grant.DeviceID != scope.deviceID ||
			*grant.SourceID != scope.sourceID || *grant.TargetNodeID != targetID {
			return errManagedSourceWriteDenied
		}
		var live meta.IOSPhotoBackgroundGrant
		if err := tx.WithContext(ctx).Clauses(clause.Locking{
			Strength: "SHARE", Options: "NOWAIT",
		}).Where("id = ? AND owner_id = ? AND device_id = ? AND source_id = ? AND target_node_id = ? AND revoked_at IS NULL AND expires_at > ?",
			grant.ID, ownerID, scope.deviceID, scope.sourceID,
			targetID, time.Now().UTC()).Take(&live).Error; err != nil ||
			live.SessionVersion != grant.SessionVersion ||
			live.ServerInstance != grant.ServerInstance ||
			!iosPhotoGrantHasManagedTarget(live) {
			return errManagedSourceWriteDenied
		}
		var currentOwner meta.User
		if err := tx.WithContext(ctx).Where(
			"id = ? AND session_version = ? AND disabled_at IS NULL",
			ownerID, grant.SessionVersion).Take(&currentOwner).Error; err != nil ||
			currentOwner.MustChangePassword {
			return errManagedSourceWriteDenied
		}
	}
	var source meta.Source
	if err := tx.WithContext(ctx).Clauses(clause.Locking{
		Strength: "SHARE", Options: "NOWAIT",
	}).Where("id = ? AND owner_id = ? AND kind = ? AND direction = ? AND device_id = ? AND revision = ?",
		scope.sourceID, ownerID, meta.SourceKindIOSPhotos,
		meta.SourceDirectionPush, scope.deviceID, scope.sourceRevision).Take(&source).Error; err != nil {
		return errManagedSourceWriteDenied
	}
	boundDeviceID, bound := meta.SourceDeviceID(source)
	if !iosPhotoDestinationSource(source) || !bound || boundDeviceID != scope.deviceID ||
		!source.TargetManaged || source.TargetNodeID == nil || *source.TargetNodeID != targetID {
		return errManagedSourceWriteDenied
	}
	var device meta.ClientDevice
	if err := tx.WithContext(ctx).Clauses(clause.Locking{
		Strength: "SHARE", Options: "NOWAIT",
	}).Where("id = ? AND owner_id = ? AND revoked_at IS NULL",
		scope.deviceID, ownerID).Take(&device).Error; err != nil ||
		device.Platform != "ios" ||
		!clientDeviceIdentityCredentialMatches(device, c.GetHeader("X-XDrive-Device-Token")) {
		return errManagedSourceWriteDenied
	}
	var node meta.Node
	if err := tx.WithContext(ctx).Where(
		"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
		targetID, ownerID, meta.NodeTypeDir).Take(&node).Error; err != nil ||
		node.Name != source.Name {
		return errManagedSourceWriteDenied
	}
	if _, err := managedSourceTargetAncestorIDsTx(tx, source, node); err != nil {
		return errManagedSourceWriteDenied
	}
	return nil
}

// Every native PhotoKit UploadSession is durably bound to one exact Source,
// Device, Source revision and managed target. Validation uses the live rows
// inside the same transaction as chunk-part, reservation or Node/CAS writes.
func requireIOSPhotoManagedSessionTx(ctx context.Context, tx *gorm.DB,
	c *gin.Context, session meta.UploadSession) error {
	scope, ok := currentIOSPhotoManagedUploadScope(c)
	if !ok || session.ID == "" || session.OwnerID != scope.ownerID ||
		session.SourceID != scope.sourceID ||
		session.SourceRevision != scope.sourceRevision ||
		session.SourceDeviceID != scope.deviceID ||
		session.SourceTargetID != scope.targetID ||
		session.SourceRootID != "" || session.SourceRootFingerprint != "" ||
		session.ShareID != nil || session.SourceRunID != "" ||
		session.NodeID != nil || session.ParentID == nil ||
		*session.ParentID != scope.targetID ||
		session.Name != session.RequestedName || session.ExpectedMD5 != "" {
		return errManagedSourceWriteDenied
	}
	req := uploadInitRequest{
		ParentID: session.ParentID, Name: session.Name,
		ConflictPolicy: session.ConflictPolicy, ExpectedRevision: session.ExpectedRevision,
		Size: session.TotalSize, ChunkSize: session.ChunkSize,
		SHA256: session.SHA256, ResumeKey: session.ResumeKey,
	}
	return requireIOSPhotoManagedUploadTx(ctx, tx, c, session.OwnerID, scope.targetID, req)
}

func requireIOSPhotoManagedFinalizeTx(ctx context.Context, tx *gorm.DB,
	c *gin.Context, session meta.UploadSession, nodeID uint64) error {
	if session.Status != meta.UploadStatusActive || session.ParentID == nil ||
		*session.ParentID != nodeID {
		return errManagedSourceWriteDenied
	}
	return requireIOSPhotoManagedSessionTx(ctx, tx, c, session)
}

func (s *Server) iosPhotoManagedCreateUpload(c *gin.Context) {
	scope, ok := s.iosPhotoManagedAuthorizedScope(c)
	if !ok {
		return
	}
	body, ok := iosBackgroundReadJSON(c, 16_384, &uploadInitRequest{})
	if !ok {
		return
	}
	var req uploadInitRequest
	if json.Unmarshal(body, &req) != nil || !validIOSPhotoManagedUploadInit(req, scope) {
		fail(c, http.StatusForbidden, "ios photo managed original upload rejected")
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	s.createUploadSession(c)
}

// Avoid letting one scoped iPhone interrogate or finalize another device's
// UploadSession, a generic Owner upload, or a previous target's session.
func (s *Server) iosPhotoManagedOwnedUpload(c *gin.Context) bool {
	scope, ok := s.iosPhotoManagedAuthorizedScope(c)
	if !ok {
		return false
	}
	parsed, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid ios photo upload ID")
		return false
	}
	var session meta.UploadSession
	if err := s.DB.WithContext(c.Request.Context()).Where(
		"id = ? AND owner_id = ? AND parent_id = ? AND node_id IS NULL AND share_id IS NULL AND COALESCE(source_run_id, '') = '' AND source_id = ? AND source_revision = ? AND source_device_id = ? AND source_target_id = ?",
		parsed.String(), scope.ownerID, scope.targetID, scope.sourceID,
		scope.sourceRevision, scope.deviceID, scope.targetID).Take(&session).Error; err != nil {
		fail(c, http.StatusForbidden, "ios photo upload session unavailable")
		return false
	}
	req := uploadInitRequest{
		ParentID: session.ParentID, Name: session.Name,
		ConflictPolicy: session.ConflictPolicy, ExpectedRevision: session.ExpectedRevision,
		Size: session.TotalSize, ChunkSize: session.ChunkSize,
		SHA256: session.SHA256, ResumeKey: session.ResumeKey,
	}
	if session.Name != session.RequestedName || session.ExpectedMD5 != "" ||
		!validIOSPhotoManagedUploadInit(req, scope) {
		fail(c, http.StatusForbidden, "ios photo upload session unavailable")
		return false
	}
	return true
}

func (s *Server) iosPhotoManagedGetUpload(c *gin.Context) {
	if !s.iosPhotoManagedOwnedUpload(c) {
		return
	}
	s.getUploadSession(c)
}

func (s *Server) iosPhotoManagedPutChunk(c *gin.Context) {
	if !s.iosPhotoManagedOwnedUpload(c) {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body,
		defaultUploadChunkSize+4096)
	s.putUploadChunk(c)
}

func (s *Server) iosPhotoManagedFinalize(c *gin.Context) {
	if !s.iosPhotoManagedOwnedUpload(c) {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	s.finalizeUploadSession(c)
}

// Read-only lost-ACK recovery uses the *existing* exact Owner/parent/name/
// size/sha/resume-key lookup. No new writer or replay path.
func (s *Server) iosPhotoManagedResumeLookup(c *gin.Context) {
	scope, ok := s.iosPhotoManagedAuthorizedScope(c)
	if !ok {
		return
	}
	body, ok := iosBackgroundReadJSON(c, 4096, &iosUploadResumeLookupRequest{})
	if !ok {
		return
	}
	var req iosUploadResumeLookupRequest
	if json.Unmarshal(body, &req) != nil ||
		req.ParentID != scope.targetID ||
		!iosBackgroundOriginalNameValid(req.Name) ||
		!validIOSUploadResumeLookupKey(req.ResumeKey) {
		fail(c, http.StatusForbidden, "ios photo upload receipt scope mismatch")
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	s.lookupIOSUploadResumeKey(c)
}

// Authenticated current Owner+Device readback for the same finalized media
// Node. A forged filename or historical unknown session is not an ACK.
func (s *Server) iosPhotoManagedReceipt(c *gin.Context) {
	scope, ok := s.iosPhotoManagedAuthorizedScope(c)
	if !ok {
		return
	}
	nodeID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || nodeID == 0 {
		fail(c, http.StatusBadRequest, "invalid scoped ios photo receipt node")
		return
	}
	var node meta.Node
	if err := s.DB.WithContext(c.Request.Context()).Preload("File").
		Where("id = ? AND owner_id = ? AND parent_id = ? AND type = ? AND deleted_at IS NULL",
			nodeID, scope.ownerID, scope.targetID, meta.NodeTypeFile).
		Take(&node).Error; err != nil || node.File == nil ||
		!iosBackgroundOriginalNameValid(node.Name) {
		fail(c, http.StatusNotFound, "ios photo original node receipt unavailable")
		return
	}
	var sessions []meta.UploadSession
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND parent_id = ? AND node_id IS NULL AND result_node_id = ? AND status = ? AND COALESCE(source_run_id, '') = '' AND share_id IS NULL AND source_id = ? AND source_revision = ? AND source_device_id = ? AND source_target_id = ?",
			scope.ownerID, scope.targetID, node.ID, meta.UploadStatusFinalized,
			scope.sourceID, scope.sourceRevision, scope.deviceID, scope.targetID).
		Order("created_at DESC, id DESC").Limit(20).Find(&sessions).Error; err != nil {
		fail(c, http.StatusInternalServerError, "ios photo original receipt read error")
		return
	}
	verified := false
	var verifiedSession meta.UploadSession
	for _, session := range sessions {
		if session.Name == node.Name && session.RequestedName == node.Name &&
			session.TotalSize == node.File.Size && session.SHA256 == node.File.SHA256 &&
			validIOSUploadResumeLookupKey(session.ResumeKey) &&
			(session.ConflictPolicy == meta.UploadConflictPolicyFail ||
				session.ConflictPolicy == "") {
			verified = true
			verifiedSession = session
			break
		}
	}
	if !verified {
		s.recordUploadAuthorizationFailure(c, "ios.photo.receipt.read", meta.UploadSession{}, errManagedSourceWriteDenied)
		fail(c, http.StatusNotFound, "ios photo original receipt unconfirmed")
		return
	}
	if err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var current meta.UploadSession
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ?", verifiedSession.ID, scope.ownerID).
			Take(&current).Error; err != nil {
			return errManagedSourceWriteDenied
		}
		verifiedSession = current
		if err := s.requireUploadSessionReadAuthorityTx(c.Request.Context(), tx, c, current); err != nil {
			return err
		}
		return recordUploadAuthorizationSuccessTx(tx, c, "ios.photo.receipt.read", current)
	}); err != nil {
		s.recordUploadAuthorizationFailure(c, "ios.photo.receipt.read", verifiedSession, err)
		fail(c, http.StatusForbidden, "ios photo receipt authority is no longer valid")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": node.ID, "parent_id": scope.targetID,
		"name": node.Name, "type": meta.NodeTypeFile,
		"size": node.File.Size, "revision": node.Revision,
		"sha256": node.File.SHA256,
	})
}
