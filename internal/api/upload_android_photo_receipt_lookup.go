package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Android's durable photo intent UUID is SHA-256-derived into a private
// and_ namespace before the very first UploadSession POST. A lost create or
// finalize ACK can then be inspected WITHOUT creating/replaying the upload.
// The iOS ios_ and local Push lp2_ key namespaces are never accepted.
func validAndroidPhotoResumeLookupKey(key string) bool {
	if len(key) != 68 || !strings.HasPrefix(key, "and_") {
		return false
	}
	for _, ch := range key[4:] {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')) {
			return false
		}
	}
	return true
}

// This logically read-only POST is the ONLY Android photo unknown-ACK
// lookup. Ordinary GET /uploads/:id is not suitable because it can abort
// expired ACTIVE sessions. Never expose generic partial upload resume.
func (s *Server) lookupAndroidPhotoUploadReceipt(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Pragma", "no-cache")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var req iosUploadResumeLookupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid Android photo receipt request")
		return
	}
	if !validAndroidPhotoResumeLookupKey(req.ResumeKey) ||
		req.ParentID == 0 || req.Size <= 0 || req.Size > s.MaxUploadBytes ||
		req.ChunkSize != defaultUploadChunkSize ||
		req.Name == "" || req.Name != strings.TrimSpace(req.Name) ||
		meta.ValidateName(req.Name) != nil ||
		req.SHA256 != strings.ToLower(req.SHA256) || !validSHA256(req.SHA256) {
		fail(c, http.StatusBadRequest, "invalid Android photo receipt identity")
		return
	}
	var matches []meta.UploadSession
	err := s.DB.WithContext(c.Request.Context()).Where(
		"owner_id = ? AND resume_key = ? AND parent_id = ? AND node_id IS NULL AND "+
			"name = ? AND requested_name = ? AND total_size = ? AND chunk_size = ? AND sha256 = ? "+
			"AND (conflict_policy = ? OR conflict_policy = '') "+
			"AND COALESCE(source_id, 0) = 0 AND COALESCE(source_run_id, '') = '' AND share_id IS NULL "+
			"AND COALESCE(source_root_id, '') = '' AND COALESCE(source_root_fingerprint, '') = '' "+
			"AND COALESCE(source_device_id, '') = '' AND COALESCE(source_target_id, 0) = 0 "+
			"AND status IN ?",
		userID(c), req.ResumeKey, req.ParentID, req.Name, req.Name, req.Size,
		req.ChunkSize, req.SHA256, meta.UploadConflictPolicyFail,
		[]string{meta.UploadStatusActive, meta.UploadStatusFinalized},
	).Order("created_at DESC, id DESC").Limit(2).Find(&matches).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusInternalServerError, "Android photo receipt lookup failed")
		return
	}
	if len(matches) == 0 {
		// A missing receipt is never proof that another POST is safe.
		s.recordUploadAuthorizationFailure(c, "android.photo.receipt.read", meta.UploadSession{}, errManagedSourceWriteDenied)
		fail(c, http.StatusNotFound, "Android photo upload not found")
		return
	}
	if len(matches) != 1 {
		s.recordUploadAuthorizationFailure(c, "android.photo.receipt.read", matches[0], errManagedSourceWriteDenied)
		fail(c, http.StatusConflict, "ambiguous Android photo upload")
		return
	}
	snapshot := matches[0]
	if !snapshot.ExpiresAt.After(time.Now()) {
		// No mutation, abort, new reservation, retry or janitor cleanup.
		s.recordUploadAuthorizationFailure(c, "android.photo.receipt.read", snapshot, errManagedSourceWriteDenied)
		fail(c, http.StatusGone, "Android photo upload receipt expired")
		return
	}
	if err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var current meta.UploadSession
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ? AND resume_key = ? AND parent_id = ? AND node_id IS NULL AND "+
				"name = ? AND requested_name = ? AND total_size = ? AND chunk_size = ? AND sha256 = ? "+
				"AND (conflict_policy = ? OR conflict_policy = '') AND "+
				"COALESCE(source_id, 0) = 0 AND COALESCE(source_run_id, '') = '' AND share_id IS NULL AND "+
				"COALESCE(source_root_id, '') = '' AND COALESCE(source_root_fingerprint, '') = '' AND "+
				"COALESCE(source_device_id, '') = '' AND COALESCE(source_target_id, 0) = 0 AND "+
				"status IN ? AND expires_at > ?",
				snapshot.ID, userID(c), req.ResumeKey, req.ParentID, req.Name, req.Name,
				req.Size, req.ChunkSize, req.SHA256, meta.UploadConflictPolicyFail,
				[]string{meta.UploadStatusActive, meta.UploadStatusFinalized}, time.Now()).
			Take(&current).Error; err != nil {
			return errManagedSourceWriteDenied
		}
		snapshot = current
		return recordUploadAuthorizationSuccessAsTx(tx, c,
			"android.photo.receipt.read", "android_photo", current)
	}); err != nil {
		s.recordUploadAuthorizationFailure(c, "android.photo.receipt.read", snapshot, err)
		if uploadAuthorizationDenied(err) {
			fail(c, http.StatusForbidden, "Android photo receipt authority is no longer valid")
		} else {
			fail(c, http.StatusInternalServerError, "Android photo receipt audit failed")
		}
		return
	}
	s.writeUploadSession(c, snapshot, http.StatusOK)
}
