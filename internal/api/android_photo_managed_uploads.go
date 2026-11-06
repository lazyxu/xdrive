package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// The Android MediaStore original writer has no Generic Owner/Files capability.
// It is authorized by an independently registered identity-only Android Device
// and precisely one server-provisioned Source, revision and managed target.
const androidPhotoManagedContextKey = "xdriveAndroidPhotoManagedUploadScope"

var androidPhotoOriginalNamePattern = regexp.MustCompile(
	`^xdrive-(photo|video)-[0-9a-f]{20}-[0-9a-f]{20}\.(?:jpg|png|heic|heif|webp|gif|avif|mp4|mov|3gp|webm|mkv)$`,
)

type androidPhotoManagedUploadScope struct {
	ownerID        uint64
	deviceID       string
	sourceID       uint64
	sourceRevision uint64
	targetID       uint64
}

func currentAndroidPhotoManagedUploadScope(c *gin.Context) (androidPhotoManagedUploadScope, bool) {
	if c == nil {
		return androidPhotoManagedUploadScope{}, false
	}
	v, ok := c.Get(androidPhotoManagedContextKey)
	scope, typed := v.(androidPhotoManagedUploadScope)
	return scope, ok && typed && scope.ownerID != 0 && scope.deviceID != "" &&
		scope.sourceID != 0 && scope.sourceRevision != 0 && scope.targetID != 0
}

func androidPhotoOriginalNameValid(name string) bool {
	return meta.ValidateName(name) == nil && androidPhotoOriginalNamePattern.MatchString(name)
}

// Capture one Owner+Device+Source+Target identity. This is a route preflight;
// every durable UploadSession/UploadPart/CAS mutation checks live DB rows again.
func (s *Server) androidPhotoManagedAuthorizedScope(c *gin.Context) (androidPhotoManagedUploadScope, bool) {
	owner, ok := currentUser(c)
	if !ok || owner.ID == 0 || owner.DisabledAt != nil || owner.MustChangePassword {
		fail(c, http.StatusForbidden, "current Android photo Owner required")
		return androidPhotoManagedUploadScope{}, false
	}
	var scope androidPhotoManagedUploadScope
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		device, err := androidPhotoDestinationDeviceTx(c, tx, owner.ID)
		if err != nil {
			return err
		}
		source, target, err := androidPhotoDestinationBindingTx(tx, device)
		if err != nil {
			return err
		}
		scope = androidPhotoManagedUploadScope{
			ownerID: owner.ID, deviceID: device.ID, sourceID: source.ID,
			sourceRevision: source.Revision, targetID: target.ID,
		}
		return nil
	})
	if err != nil {
		fail(c, http.StatusForbidden, "verified Android photo Source and Device required")
		return androidPhotoManagedUploadScope{}, false
	}
	c.Set(androidPhotoManagedContextKey, scope)
	c.Header("Cache-Control", "private, no-store")
	return scope, true
}

func validAndroidPhotoManagedUploadInit(req uploadInitRequest, scope androidPhotoManagedUploadScope) bool {
	return scope.targetID != 0 && req.ParentID != nil &&
		*req.ParentID == scope.targetID && req.NodeID == nil &&
		androidPhotoOriginalNameValid(req.Name) &&
		req.ConflictPolicy == meta.UploadConflictPolicyFail &&
		req.ExpectedRevision == 0 && req.MD5 == "" &&
		req.SourceID == 0 && req.SourceRevision == 0 &&
		req.SourceRootID == "" && req.SourceRootFingerprint == "" &&
		req.Size > 0 && req.ChunkSize == defaultUploadChunkSize &&
		req.SHA256 == strings.ToLower(req.SHA256) && validSHA256(req.SHA256) &&
		validAndroidPhotoResumeLookupKey(req.ResumeKey) &&
		len(req.ChunkSHA256) == 0
}

// This is the actual write-transaction authorization. An expired Owner session,
// renamed Source, revoked Android Device or replaced managed target makes the
// entire transaction fail, not just the route preflight.
func requireAndroidPhotoManagedUploadTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context,
	ownerID, targetID uint64, req uploadInitRequest,
) error {
	scope, ok := currentAndroidPhotoManagedUploadScope(c)
	if tx == nil || !ok || scope.ownerID != ownerID || scope.targetID != targetID ||
		!validAndroidPhotoManagedUploadInit(req, scope) {
		return errManagedSourceWriteDenied
	}
	owner, valid := currentUser(c)
	if !valid || owner.ID != ownerID {
		return errManagedSourceWriteDenied
	}
	var liveOwner meta.User
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "SHARE", Options: "NOWAIT"}).
		Where("id = ? AND session_version = ? AND disabled_at IS NULL AND must_change_password = FALSE",
			owner.ID, owner.SessionVersion).Take(&liveOwner).Error; err != nil {
		return errManagedSourceWriteDenied
	}
	var device meta.ClientDevice
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "SHARE", Options: "NOWAIT"}).
		Where("id = ? AND owner_id = ? AND platform = ? AND revoked_at IS NULL",
			scope.deviceID, ownerID, "android").Take(&device).Error; err != nil ||
		!clientDeviceIdentityCredentialMatches(device, c.GetHeader("X-XDrive-Device-Token")) {
		return errManagedSourceWriteDenied
	}
	var source meta.Source
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "SHARE", Options: "NOWAIT"}).
		Where("id = ? AND owner_id = ? AND device_id = ? AND revision = ?",
			scope.sourceID, ownerID, device.ID, scope.sourceRevision).
		Take(&source).Error; err != nil {
		return errManagedSourceWriteDenied
	}
	boundID, bound := meta.SourceDeviceID(source)
	if !bound || boundID != device.ID || source.Kind != meta.SourceKindAndroidPhotos ||
		source.Direction != meta.SourceDirectionPush || source.SyncMode != meta.SourceSyncModeBackup ||
		source.Status != meta.SourceStatusPaused || !source.TargetManaged ||
		source.TargetNodeID == nil || *source.TargetNodeID != targetID {
		return errManagedSourceWriteDenied
	}
	var target meta.Node
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "SHARE", Options: "NOWAIT"}).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			targetID, ownerID, meta.NodeTypeDir).Take(&target).Error; err != nil ||
		target.Name != source.Name {
		return errManagedSourceWriteDenied
	}
	if _, err := managedSourceTargetAncestorIDsTx(tx, source, target); err != nil {
		return errManagedSourceWriteDenied
	}
	return nil
}

func requireAndroidPhotoManagedSessionTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, session meta.UploadSession,
) error {
	scope, ok := currentAndroidPhotoManagedUploadScope(c)
	if !ok || session.ID == "" || session.OwnerID != scope.ownerID ||
		session.SourceID != scope.sourceID || session.SourceRevision != scope.sourceRevision ||
		session.SourceDeviceID != scope.deviceID || session.SourceTargetID != scope.targetID ||
		session.SourceRootID != "" || session.SourceRootFingerprint != "" ||
		session.SourceRunID != "" || session.ShareID != nil ||
		session.ParentID == nil || *session.ParentID != scope.targetID || session.NodeID != nil ||
		session.Name != session.RequestedName || session.ExpectedMD5 != "" ||
		(session.Status != meta.UploadStatusActive && session.Status != meta.UploadStatusFinalized) {
		return errManagedSourceWriteDenied
	}
	req := uploadInitRequest{
		ParentID: session.ParentID, Name: session.Name, Size: session.TotalSize,
		ChunkSize: session.ChunkSize, SHA256: session.SHA256, ResumeKey: session.ResumeKey,
		ConflictPolicy: session.ConflictPolicy, ExpectedRevision: session.ExpectedRevision,
	}
	return requireAndroidPhotoManagedUploadTx(ctx, tx, c, session.OwnerID, scope.targetID, req)
}

func (s *Server) androidPhotoManagedCreateUpload(c *gin.Context) {
	scope, ok := s.androidPhotoManagedAuthorizedScope(c)
	if !ok {
		return
	}
	// Use the canonical bounded JSON parser, then the ONLY CAS/UploadSession
	// writer. Client-controlled Source identity is never accepted or persisted.
	body, ok := iosBackgroundReadJSON(c, 16_384, &uploadInitRequest{})
	if !ok {
		return
	}
	var req uploadInitRequest
	if json.Unmarshal(body, &req) != nil || !validAndroidPhotoManagedUploadInit(req, scope) {
		fail(c, http.StatusForbidden, "Android photo original upload scope denied")
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	s.createUploadSession(c)
}

func (s *Server) androidPhotoManagedOwnedUpload(c *gin.Context) bool {
	scope, ok := s.androidPhotoManagedAuthorizedScope(c)
	if !ok {
		return false
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid Android photo UploadSession ID")
		return false
	}
	var session meta.UploadSession
	if err := s.DB.WithContext(c.Request.Context()).
		Where("id = ? AND owner_id = ? AND parent_id = ? AND node_id IS NULL AND share_id IS NULL "+
			"AND COALESCE(source_run_id, '') = '' AND source_id = ? AND source_revision = ? "+
			"AND source_device_id = ? AND source_target_id = ? AND source_root_id = '' AND source_root_fingerprint = ''",
			id.String(), scope.ownerID, scope.targetID,
			scope.sourceID, scope.sourceRevision, scope.deviceID, scope.targetID).
		Take(&session).Error; err != nil {
		fail(c, http.StatusForbidden, "Android photo session is unavailable")
		return false
	}
	req := uploadInitRequest{
		ParentID: session.ParentID, Name: session.Name, ConflictPolicy: session.ConflictPolicy,
		Size: session.TotalSize, ChunkSize: session.ChunkSize, SHA256: session.SHA256,
		ResumeKey: session.ResumeKey, ExpectedRevision: session.ExpectedRevision,
	}
	if !validAndroidPhotoManagedUploadInit(req, scope) || session.Name != session.RequestedName ||
		session.ExpectedMD5 != "" {
		fail(c, http.StatusForbidden, "Android photo session provenance invalid")
		return false
	}
	return true
}

func (s *Server) androidPhotoManagedGetUpload(c *gin.Context) {
	if s.androidPhotoManagedOwnedUpload(c) {
		s.getUploadSession(c)
	}
}

func (s *Server) androidPhotoManagedPutChunk(c *gin.Context) {
	if !s.androidPhotoManagedOwnedUpload(c) {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, defaultUploadChunkSize+4096)
	s.putUploadChunk(c)
}

func (s *Server) androidPhotoManagedFinalizeUpload(c *gin.Context) {
	if !s.androidPhotoManagedOwnedUpload(c) {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	s.finalizeUploadSession(c)
}

// Lost-ACK recovery is strictly read-only. It reuses the existing Android
// resume-key lookup but binds its exact identity to this native Source scope.
func (s *Server) androidPhotoManagedResumeLookup(c *gin.Context) {
	scope, ok := s.androidPhotoManagedAuthorizedScope(c)
	if !ok {
		return
	}
	body, ok := iosBackgroundReadJSON(c, 4096, &iosUploadResumeLookupRequest{})
	if !ok {
		return
	}
	var req iosUploadResumeLookupRequest
	if json.Unmarshal(body, &req) != nil ||
		req.ParentID != scope.targetID || req.Size <= 0 ||
		req.ChunkSize != defaultUploadChunkSize || !androidPhotoOriginalNameValid(req.Name) ||
		!validAndroidPhotoResumeLookupKey(req.ResumeKey) || !validSHA256(req.SHA256) {
		fail(c, http.StatusForbidden, "Android photo receipt scope mismatch")
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	s.lookupAndroidPhotoUploadReceipt(c)
}
