package api

import (
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// The iOS encrypted intent ledger stores a deterministic HMAC-derived
// resume_key BEFORE POST /uploads. A lost creation ACK leaves no session UUID.
// This endpoint is a strictly read-only, Owner-scoped lookup of that existing
// intent: it never creates a new upload, reserves space, or finalizes bytes.
type iosUploadResumeLookupRequest struct {
	ResumeKey string `json:"resume_key"`
	ParentID  uint64 `json:"parent_id"`
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	ChunkSize int64  `json:"chunk_size"`
	SHA256    string `json:"sha256"`
}

// Deliberately refuse the generic legacy resume_key namespace, especially
// lp2_ local-Push operation keys. Only the native iOS ledger's 256-bit HMAC
// namespace can be inspected by this read-only convenience route.
func validIOSUploadResumeLookupKey(key string) bool {
	if len(key) != len("ios_")+64 || !strings.HasPrefix(key, "ios_") {
		return false
	}
	for _, ch := range key[len("ios_"):] {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')) {
			return false
		}
	}
	decoded, err := hex.DecodeString(key[len("ios_"):])
	return err == nil && len(decoded) == 32
}

func (s *Server) lookupIOSUploadResumeKey(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Pragma", "no-cache")
	// Do not place resume keys in URL query strings, access logs or links.
	// This POST is logically read-only and rejects oversized JSON.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var req iosUploadResumeLookupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid upload reconciliation request")
		return
	}
	if !validIOSUploadResumeLookupKey(req.ResumeKey) ||
		req.ParentID == 0 || req.Size < 0 || req.Size > s.MaxUploadBytes ||
		req.ChunkSize != defaultUploadChunkSize ||
		req.Name == "" || req.Name != strings.TrimSpace(req.Name) ||
		meta.ValidateName(req.Name) != nil ||
		req.SHA256 != strings.ToLower(req.SHA256) || !validSHA256(req.SHA256) {
		fail(c, http.StatusBadRequest, "invalid upload reconciliation identity")
		return
	}

	// The exact Owner, HMAC key, destination, file digest, size and chunk
	// length must agree. No cross-owner, overwrite, skipped, Source/Root
	// or renamed-session recovery is allowed from this endpoint.
	var rows []meta.UploadSession
	q := s.DB.WithContext(c.Request.Context()).
		Where(
			"owner_id = ? AND resume_key = ? AND parent_id = ? AND node_id IS NULL AND "+
				"name = ? AND requested_name = ? AND total_size = ? AND chunk_size = ? AND sha256 = ? "+
				"AND (conflict_policy = ? OR conflict_policy = '') "+
				"AND COALESCE(source_run_id, '') = '' AND share_id IS NULL "+
				"AND COALESCE(source_root_id, '') = '' AND COALESCE(source_root_fingerprint, '') = '' "+
				"AND status IN ?",
			userID(c), req.ResumeKey, req.ParentID, req.Name, req.Name, req.Size,
			req.ChunkSize, req.SHA256, meta.UploadConflictPolicyFail,
			[]string{meta.UploadStatusActive, meta.UploadStatusFinalized},
		)
	// A native iPhone receipt is scoped to its currently verified Source and
	// owning Device, not merely a same-Owner resumable HMAC key.
	if native, ok := currentIOSPhotoManagedUploadScope(c); ok {
		q = q.Where("source_id = ? AND source_revision = ? AND source_device_id = ? AND source_target_id = ?",
			native.sourceID, native.sourceRevision, native.deviceID, native.targetID)
	} else {
		q = q.Where("COALESCE(source_id, 0) = 0 AND COALESCE(source_device_id, '') = '' AND COALESCE(source_target_id, 0) = 0")
	}
	err := q.Order("created_at DESC, id DESC").Limit(2).Find(&rows).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusInternalServerError, "upload reconciliation lookup failed")
		return
	}
	if len(rows) == 0 {
		// No durable proof of a committed upload. The client must not infer
		// it can safely resend a create POST with a fresh resume key.
		s.recordUploadAuthorizationFailure(c, "ios.photo.resume_lookup", meta.UploadSession{}, errManagedSourceWriteDenied)
		fail(c, http.StatusNotFound, "matching upload session not found")
		return
	}
	if len(rows) != 1 {
		s.recordUploadAuthorizationFailure(c, "ios.photo.resume_lookup", rows[0], errManagedSourceWriteDenied)
		fail(c, http.StatusConflict, "ambiguous upload session identity")
		return
	}
	snapshot := rows[0]
	if !snapshot.ExpiresAt.After(time.Now()) {
		// Do not call the existing GET handler's abort/cleanup path here:
		// unknown intent lookup must remain genuinely side-effect-free.
		s.recordUploadAuthorizationFailure(c, "ios.photo.resume_lookup", snapshot, errManagedSourceWriteDenied)
		fail(c, http.StatusGone, "matching upload session expired")
		return
	}
	if err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var current meta.UploadSession
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ?", snapshot.ID, userID(c)).Take(&current).Error; err != nil {
			return errManagedSourceWriteDenied
		}
		snapshot = current
		if err := s.requireUploadSessionReadAuthorityTx(c.Request.Context(), tx, c, current); err != nil {
			return err
		}
		return recordUploadAuthorizationSuccessTx(tx, c, "ios.photo.resume_lookup", current)
	}); err != nil {
		s.recordUploadAuthorizationFailure(c, "ios.photo.resume_lookup", snapshot, err)
		fail(c, http.StatusForbidden, "upload receipt authority is no longer valid")
		return
	}
	s.writeUploadSession(c, snapshot, http.StatusOK)
}
