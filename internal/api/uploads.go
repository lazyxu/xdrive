package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultUploadChunkSize = int64(8 << 20)
	minUploadChunkSize     = int64(4 << 20)
	maxUploadChunkSize     = int64(16 << 20)
	uploadSessionTTL       = 24 * time.Hour
)

var (
	errUploadExpired   = errors.New("upload expired")
	errUploadFinalized = errors.New("upload finalized")
	errUploadNameTaken = errors.New("upload target name exists")
)

type uploadInitRequest struct {
	ParentID         *uint64  `json:"parent_id,omitempty"`
	NodeID           *uint64  `json:"node_id,omitempty"`
	Name             string   `json:"name,omitempty"`
	Size             int64    `json:"size"`
	ChunkSize        int64    `json:"chunk_size,omitempty"`
	SHA256           string   `json:"sha256,omitempty"`
	ChunkSHA256      []string `json:"chunk_sha256,omitempty"`
	ResumeKey        string   `json:"resume_key,omitempty"`
	ExpectedRevision uint64   `json:"expected_revision,omitempty"`
}

type uploadPartDTO struct {
	Index  int    `json:"index"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	Reused bool   `json:"reused,omitempty"`
}

type uploadSessionDTO struct {
	ID               string          `json:"id"`
	ParentID         *uint64         `json:"parent_id,omitempty"`
	NodeID           *uint64         `json:"node_id,omitempty"`
	Name             string          `json:"name,omitempty"`
	Size             int64           `json:"size"`
	ChunkSize        int64           `json:"chunk_size"`
	ChunkCount       int             `json:"chunk_count"`
	SHA256           string          `json:"sha256,omitempty"`
	ResumeKey        string          `json:"resume_key,omitempty"`
	ExpectedRevision uint64          `json:"expected_revision,omitempty"`
	Status           string          `json:"status"`
	ExpiresAt        time.Time       `json:"expires_at"`
	Received         []uploadPartDTO `json:"received_chunks"`
	Result           *nodeDTO        `json:"result,omitempty"`
}

func (s *Server) createUploadSession(c *gin.Context) {
	var req uploadInitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if req.Size < 0 || req.Size > s.MaxUploadBytes {
		fail(c, http.StatusRequestEntityTooLarge, "file too large")
		return
	}
	if req.ChunkSize == 0 {
		req.ChunkSize = defaultUploadChunkSize
	}
	if req.ChunkSize < minUploadChunkSize || req.ChunkSize > maxUploadChunkSize {
		fail(c, http.StatusBadRequest, "chunk_size must be between 4 MiB and 16 MiB")
		return
	}
	req.SHA256 = strings.ToLower(strings.TrimSpace(req.SHA256))
	if req.SHA256 != "" && !validSHA256(req.SHA256) {
		fail(c, http.StatusBadRequest, "invalid sha256")
		return
	}
	req.ResumeKey = strings.TrimSpace(req.ResumeKey)
	if len(req.ResumeKey) > 128 {
		fail(c, http.StatusBadRequest, "resume_key too long")
		return
	}
	if (req.ParentID == nil) == (req.NodeID == nil) {
		fail(c, http.StatusBadRequest, "exactly one of parent_id or node_id is required")
		return
	}

	chunkCount := 0
	if req.Size > 0 {
		chunkCount = int((req.Size + req.ChunkSize - 1) / req.ChunkSize)
	}
	if len(req.ChunkSHA256) != 0 {
		if len(req.ChunkSHA256) != chunkCount {
			fail(c, http.StatusBadRequest, "chunk_sha256 count does not match file size")
			return
		}
		for index, hash := range req.ChunkSHA256 {
			req.ChunkSHA256[index] = strings.ToLower(strings.TrimSpace(hash))
			if !validSHA256(req.ChunkSHA256[index]) {
				fail(c, http.StatusBadRequest, "invalid chunk_sha256")
				return
			}
		}
	}

	uid := userID(c)
	_ = s.cleanupExpiredUploads(c.Request.Context(), uid)

	// Resume lookup happens before target-state validation so a client that
	// lost the final response can recover the already-finalized result instead
	// of seeing a duplicate-name or stale-revision error.
	if req.ResumeKey != "" {
		var existing meta.UploadSession
		q := s.DB.Where("owner_id = ? AND resume_key = ? AND total_size = ? AND chunk_size = ? AND status IN ?",
			uid, req.ResumeKey, req.Size, req.ChunkSize, []string{meta.UploadStatusActive, meta.UploadStatusFinalized})
		if req.NodeID != nil {
			q = q.Where("node_id = ? AND expected_revision = ?", *req.NodeID, req.ExpectedRevision)
		} else {
			q = q.Where("parent_id = ? AND name = ?", *req.ParentID, req.Name)
		}
		if req.SHA256 != "" {
			q = q.Where("sha256 = ? OR sha256 = ''", req.SHA256)
		}
		if err := q.Order("created_at DESC").First(&existing).Error; err == nil {
			if existing.Status == meta.UploadStatusFinalized {
				s.writeUploadSession(c, existing, http.StatusOK)
				return
			}
			if time.Now().Before(existing.ExpiresAt) {
				if _, err := s.ensureQuota(s.DB, uid, existing.TotalSize, false); err != nil {
					if !writeQuotaError(c, err) {
						fail(c, http.StatusInternalServerError, "quota check failed")
					}
					return
				}
				if existing.SHA256 == "" && req.SHA256 != "" {
					_ = s.DB.Model(&existing).Update("sha256", req.SHA256).Error
					existing.SHA256 = req.SHA256
				}
				s.writeUploadSession(c, existing, http.StatusOK)
				return
			}
		}
	}

	var reuseSource *meta.File
	if req.NodeID != nil {
		n, err := s.ownedNode(uid, *req.NodeID, true)
		if err != nil || n.Type != meta.NodeTypeFile || n.File == nil {
			fail(c, http.StatusNotFound, "file not found")
			return
		}
		if req.ExpectedRevision == 0 {
			fail(c, http.StatusBadRequest, "expected_revision is required for overwrite")
			return
		}
		if n.Revision != req.ExpectedRevision {
			revisionConflict(c, req.ExpectedRevision, n.Revision)
			return
		}
		source := *n.File
		reuseSource = &source
		req.Name = n.Name
	} else {
		if _, err := s.ownedDirectory(uid, *req.ParentID); err != nil {
			fail(c, statusForLookup(err), "parent directory not found")
			return
		}
		if err := meta.ValidateName(req.Name); err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		if s.nameExists(uid, *req.ParentID, req.Name, 0) {
			fail(c, http.StatusConflict, "name already exists")
			return
		}
	}

	if _, err := s.ensureQuota(s.DB, uid, req.Size, false); err != nil {
		if !writeQuotaError(c, err) {
			fail(c, http.StatusInternalServerError, "quota check failed")
		}
		return
	}

	session := meta.UploadSession{
		ID:               uuid.NewString(),
		OwnerID:          uid,
		ParentID:         req.ParentID,
		NodeID:           req.NodeID,
		Name:             req.Name,
		ExpectedRevision: req.ExpectedRevision,
		TotalSize:        req.Size,
		ChunkSize:        req.ChunkSize,
		ChunkCount:       chunkCount,
		SHA256:           req.SHA256,
		ResumeKey:        req.ResumeKey,
		Status:           meta.UploadStatusActive,
		ExpiresAt:        time.Now().Add(uploadSessionTTL),
	}
	var reusable []meta.UploadPart
	if reuseSource != nil && len(req.ChunkSHA256) != 0 {
		var err error
		reusable, err = s.reusableUploadParts(c.Request.Context(), session, *reuseSource, req.ChunkSHA256)
		if err != nil {
			fail(c, http.StatusInternalServerError, "prepare reusable chunks failed")
			return
		}
	}
	if err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&session).Error; err != nil {
			return err
		}
		if len(reusable) != 0 {
			return tx.Create(&reusable).Error
		}
		return nil
	}); err != nil {
		fail(c, http.StatusInternalServerError, "create upload session failed")
		return
	}
	s.writeUploadSession(c, session, http.StatusCreated)
}

func (s *Server) getUploadSession(c *gin.Context) {
	session, err := s.ownedUploadSession(userID(c), c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, "upload session not found")
		return
	}
	if session.Status == meta.UploadStatusActive && time.Now().After(session.ExpiresAt) {
		_ = s.abortUploadSessionData(c.Request.Context(), session)
		fail(c, http.StatusGone, "upload session expired")
		return
	}
	s.writeUploadSession(c, session, http.StatusOK)
}

func (s *Server) putUploadChunk(c *gin.Context) {
	session, err := s.ownedUploadSession(userID(c), c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, "upload session not found")
		return
	}
	if session.Status != meta.UploadStatusActive {
		fail(c, http.StatusConflict, "upload session is finalized")
		return
	}
	if time.Now().After(session.ExpiresAt) {
		_ = s.abortUploadSessionData(c.Request.Context(), session)
		fail(c, http.StatusGone, "upload session expired")
		return
	}
	index64, err := strconv.ParseInt(c.Param("index"), 10, 32)
	if err != nil || index64 < 0 || int(index64) >= session.ChunkCount {
		fail(c, http.StatusBadRequest, "invalid chunk index")
		return
	}
	index := int(index64)
	expectedSize := expectedPartSize(session, index)
	expectedHash := strings.ToLower(strings.TrimSpace(c.GetHeader("X-Chunk-SHA256")))
	if !validSHA256(expectedHash) {
		fail(c, http.StatusBadRequest, "X-Chunk-SHA256 is required")
		return
	}

	var existing meta.UploadPart
	if err := s.DB.Where("session_id = ? AND part_index = ?", session.ID, index).First(&existing).Error; err == nil {
		if existing.Size == expectedSize && strings.EqualFold(existing.SHA256, expectedHash) {
			c.JSON(http.StatusOK, uploadPartDTO{Index: index, Size: existing.Size, SHA256: existing.SHA256, Reused: existing.Reused})
			return
		}
	}

	key := fmt.Sprintf(".xdrive-uploads/%d/%s/%06d-%s", session.OwnerID, session.ID, index, uuid.NewString())
	h := sha256.New()
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, expectedSize+1)
	size, err := s.Store.Put(c.Request.Context(), key, io.TeeReader(c.Request.Body, h))
	if err != nil {
		_ = s.Store.Delete(c.Request.Context(), key)
		fail(c, http.StatusInternalServerError, "chunk storage write failed")
		return
	}
	actualHash := hex.EncodeToString(h.Sum(nil))
	if size != expectedSize {
		_ = s.Store.Delete(c.Request.Context(), key)
		fail(c, http.StatusBadRequest, "chunk size mismatch")
		return
	}
	if !strings.EqualFold(actualHash, expectedHash) {
		_ = s.Store.Delete(c.Request.Context(), key)
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, gin.H{
			"error": "chunk_hash_mismatch", "expected": expectedHash, "actual": actualHash,
		})
		return
	}

	oldKey := ""
	oldReused := false
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		var current meta.UploadSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND owner_id = ?", session.ID, session.OwnerID).First(&current).Error; err != nil {
			return err
		}
		if current.Status != meta.UploadStatusActive {
			return errUploadFinalized
		}
		if time.Now().After(current.ExpiresAt) {
			return errUploadExpired
		}
		var old meta.UploadPart
		findErr := tx.Where("session_id = ? AND part_index = ?", session.ID, index).First(&old).Error
		if findErr == nil {
			oldKey = old.StorageKey
			oldReused = old.Reused
			return tx.Model(&old).Updates(map[string]any{
				"size": size, "sha256": actualHash, "storage_key": key,
				"reused": false, "source_storage_key": "", "source_offset": 0,
				"updated_at": time.Now(),
			}).Error
		}
		if !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return findErr
		}
		return tx.Create(&meta.UploadPart{
			SessionID: session.ID, PartIndex: index, Size: size, SHA256: actualHash, StorageKey: key,
		}).Error
	})
	if err != nil {
		_ = s.Store.Delete(c.Request.Context(), key)
		switch {
		case errors.Is(err, errUploadFinalized):
			fail(c, http.StatusConflict, "upload session is finalized")
		case errors.Is(err, errUploadExpired):
			fail(c, http.StatusGone, "upload session expired")
		default:
			fail(c, http.StatusInternalServerError, "record chunk failed")
		}
		return
	}
	if oldKey != "" && oldKey != key && !oldReused {
		_ = s.Store.Delete(c.Request.Context(), oldKey)
	}
	c.JSON(http.StatusCreated, uploadPartDTO{Index: index, Size: size, SHA256: actualHash})
}

func (s *Server) finalizeUploadSession(c *gin.Context) {
	session, err := s.ownedUploadSession(userID(c), c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, "upload session not found")
		return
	}
	if session.Status == meta.UploadStatusFinalized {
		s.writeUploadSession(c, session, http.StatusOK)
		return
	}
	if time.Now().After(session.ExpiresAt) {
		_ = s.abortUploadSessionData(c.Request.Context(), session)
		fail(c, http.StatusGone, "upload session expired")
		return
	}
	// Fail before assembling a new retained blob when the quota is already
	// exhausted. The transaction below repeats this check while holding the
	// user row lock so concurrent finalizes cannot jointly oversubscribe quota.
	if _, err := s.ensureQuota(s.DB, session.OwnerID, session.TotalSize, false); err != nil {
		if !writeQuotaError(c, err) {
			fail(c, http.StatusInternalServerError, "quota check failed")
		}
		return
	}

	var parts []meta.UploadPart
	if err := s.DB.Where("session_id = ?", session.ID).Order("part_index ASC").Find(&parts).Error; err != nil {
		fail(c, http.StatusInternalServerError, "load upload chunks failed")
		return
	}
	if len(parts) != session.ChunkCount {
		c.AbortWithStatusJSON(http.StatusConflict, gin.H{
			"error": "upload_incomplete", "received": len(parts), "expected": session.ChunkCount,
		})
		return
	}
	for i, part := range parts {
		if part.PartIndex != i || part.Size != expectedPartSize(session, i) {
			fail(c, http.StatusConflict, "upload_incomplete")
			return
		}
	}

	var targetLogical string
	if session.NodeID != nil {
		n, err := s.ownedNode(session.OwnerID, *session.NodeID, true)
		if err != nil || n.Type != meta.NodeTypeFile || n.File == nil {
			fail(c, http.StatusNotFound, "file not found")
			return
		}
		targetLogical, err = s.logicalPath(n)
		if err != nil {
			fail(c, http.StatusInternalServerError, "cannot resolve path")
			return
		}
	} else {
		parent, err := s.ownedDirectory(session.OwnerID, *session.ParentID)
		if err != nil {
			fail(c, http.StatusNotFound, "parent directory not found")
			return
		}
		targetLogical, err = s.logicalPath(parent)
		if err != nil {
			fail(c, http.StatusInternalServerError, "cannot resolve path")
			return
		}
	}

	newKey := storageKey(session.OwnerID, targetLogical, uuid.NewString())
	seq := &uploadPartSequence{ctx: c.Request.Context(), store: s.Store, parts: parts}
	fullHash := sha256.New()
	size, putErr := s.Store.Put(c.Request.Context(), newKey, io.TeeReader(seq, fullHash))
	closeErr := seq.Close()
	if putErr != nil {
		_ = s.Store.Delete(c.Request.Context(), newKey)
		fail(c, http.StatusInternalServerError, "assemble upload failed")
		return
	}
	if closeErr != nil {
		_ = s.Store.Delete(c.Request.Context(), newKey)
		fail(c, http.StatusInternalServerError, "close upload chunks failed")
		return
	}
	if size != session.TotalSize {
		_ = s.Store.Delete(c.Request.Context(), newKey)
		fail(c, http.StatusConflict, "assembled size mismatch")
		return
	}
	actualHash := hex.EncodeToString(fullHash.Sum(nil))
	if session.SHA256 != "" && !strings.EqualFold(actualHash, session.SHA256) {
		_ = s.Store.Delete(c.Request.Context(), newKey)
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, gin.H{
			"error": "file_hash_mismatch", "expected": session.SHA256, "actual": actualHash,
		})
		return
	}

	var (
		result          meta.Node
		currentRevision uint64
	)
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		var currentSession meta.UploadSession
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", session.ID, session.OwnerID).First(&currentSession).Error; err != nil {
			return err
		}
		if currentSession.Status == meta.UploadStatusFinalized {
			return errUploadFinalized
		}
		if time.Now().After(currentSession.ExpiresAt) {
			return errUploadExpired
		}
		if _, err := s.ensureQuota(tx, currentSession.OwnerID, currentSession.TotalSize, true); err != nil {
			return err
		}

		now := time.Now()
		if currentSession.NodeID == nil {
			if s.nameExistsTx(tx, currentSession.OwnerID, *currentSession.ParentID, currentSession.Name, 0) {
				return errUploadNameTaken
			}
			result = meta.Node{
				ParentID: currentSession.ParentID, Name: currentSession.Name,
				Type: meta.NodeTypeFile, OwnerID: currentSession.OwnerID, Revision: 1,
			}
			if err := tx.Create(&result).Error; err != nil {
				return err
			}
			if err := tx.Create(&meta.File{
				NodeID: result.ID, Size: size, StorageKey: newKey, SHA256: actualHash,
			}).Error; err != nil {
				return err
			}
		} else {
			var current meta.Node
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ? AND owner_id = ? AND deleted_at IS NULL", *currentSession.NodeID, currentSession.OwnerID).
				First(&current).Error; err != nil {
				return err
			}
			currentRevision = current.Revision
			if current.Revision != currentSession.ExpectedRevision {
				return errRevisionConflict
			}
			var file meta.File
			if err := tx.Where("node_id = ?", current.ID).First(&file).Error; err != nil {
				return err
			}
			if err := tx.Create(&meta.FileVersion{
				NodeID: current.ID, Revision: current.Revision, Size: file.Size,
				StorageKey: file.StorageKey, SHA256: file.SHA256, CreatedAt: now,
			}).Error; err != nil {
				return err
			}
			if err := tx.Model(&meta.File{}).Where("node_id = ?", current.ID).Updates(map[string]any{
				"size": size, "storage_key": newKey, "sha256": actualHash, "updated_at": now,
			}).Error; err != nil {
				return err
			}
			if err := tx.Model(&meta.Node{}).
				Where("id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL", current.ID, currentSession.OwnerID, currentSession.ExpectedRevision).
				Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now}).Error; err != nil {
				return err
			}
			result.ID = current.ID
		}

		resultID := result.ID
		if err := tx.Model(&meta.UploadSession{}).Where("id = ?", currentSession.ID).Updates(map[string]any{
			"status": meta.UploadStatusFinalized, "result_node_id": resultID,
			"sha256": actualHash, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		return tx.Where("session_id = ?", currentSession.ID).Delete(&meta.UploadPart{}).Error
	})
	if err != nil {
		_ = s.Store.Delete(c.Request.Context(), newKey)
		if writeQuotaError(c, err) {
			return
		}
		switch {
		case errors.Is(err, errUploadFinalized):
			fresh, lookupErr := s.ownedUploadSession(session.OwnerID, session.ID)
			if lookupErr != nil {
				fail(c, http.StatusInternalServerError, "reload upload session failed")
				return
			}
			s.writeUploadSession(c, fresh, http.StatusOK)
		case errors.Is(err, errUploadExpired):
			fail(c, http.StatusGone, "upload session expired")
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, session.ExpectedRevision, currentRevision)
		case errors.Is(err, errUploadNameTaken) || isDuplicate(err):
			fail(c, http.StatusConflict, "name already exists")
		default:
			fail(c, http.StatusInternalServerError, "finalize upload failed")
		}
		return
	}
	for _, part := range parts {
		if !part.Reused {
			_ = s.Store.Delete(c.Request.Context(), part.StorageKey)
		}
	}
	fresh, err := s.ownedUploadSession(session.OwnerID, session.ID)
	if err != nil {
		fail(c, http.StatusInternalServerError, "reload upload session failed")
		return
	}
	s.writeUploadSession(c, fresh, http.StatusOK)
}

func (s *Server) abortUploadSession(c *gin.Context) {
	session, err := s.ownedUploadSession(userID(c), c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, "upload session not found")
		return
	}
	if session.Status == meta.UploadStatusFinalized {
		fail(c, http.StatusConflict, "finalized upload cannot be aborted")
		return
	}
	if err := s.abortUploadSessionData(c.Request.Context(), session); err != nil {
		fail(c, http.StatusInternalServerError, "abort upload failed")
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) writeUploadSession(c *gin.Context, session meta.UploadSession, status int) {
	var parts []meta.UploadPart
	_ = s.DB.Where("session_id = ?", session.ID).Order("part_index ASC").Find(&parts).Error
	out := uploadSessionDTO{
		ID: session.ID, ParentID: session.ParentID, NodeID: session.NodeID, Name: session.Name,
		Size: session.TotalSize, ChunkSize: session.ChunkSize, ChunkCount: session.ChunkCount,
		SHA256: session.SHA256, ResumeKey: session.ResumeKey, ExpectedRevision: session.ExpectedRevision,
		Status: session.Status, ExpiresAt: session.ExpiresAt,
		Received: make([]uploadPartDTO, 0, len(parts)),
	}
	for _, part := range parts {
		out.Received = append(out.Received, uploadPartDTO{Index: part.PartIndex, Size: part.Size, SHA256: part.SHA256, Reused: part.Reused})
	}
	if session.ResultNodeID != nil {
		if n, err := s.ownedNode(session.OwnerID, *session.ResultNodeID, true); err == nil {
			dto := toNodeDTO(n)
			out.Result = &dto
			if n.File != nil {
				out.SHA256 = n.File.SHA256
			}
		}
	}
	c.JSON(status, out)
}

func (s *Server) ownedUploadSession(uid uint64, id string) (meta.UploadSession, error) {
	var session meta.UploadSession
	if err := s.DB.Where("id = ? AND owner_id = ?", id, uid).First(&session).Error; err != nil {
		return session, err
	}
	return session, nil
}

func (s *Server) reusableUploadParts(ctx context.Context, session meta.UploadSession, source meta.File, localHashes []string) ([]meta.UploadPart, error) {
	if session.ChunkCount == 0 || source.Size <= 0 || len(localHashes) == 0 {
		return nil, nil
	}
	f, err := s.Store.Open(ctx, source.StorageKey)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	sourceCount := int((source.Size + session.ChunkSize - 1) / session.ChunkSize)
	limit := session.ChunkCount
	if sourceCount < limit {
		limit = sourceCount
	}
	parts := make([]meta.UploadPart, 0, limit)
	for index := 0; index < limit; index++ {
		sourceSize := session.ChunkSize
		sourceOffset := int64(index) * session.ChunkSize
		if remain := source.Size - sourceOffset; remain < sourceSize {
			sourceSize = remain
		}
		targetSize := expectedPartSize(session, index)
		if sourceSize != targetSize || targetSize <= 0 {
			continue
		}
		h := sha256.New()
		n, err := io.Copy(h, io.NewSectionReader(f, sourceOffset, sourceSize))
		if err != nil {
			return nil, err
		}
		if n != sourceSize {
			return nil, fmt.Errorf("short read while hashing reusable chunk %d: got %d want %d", index, n, sourceSize)
		}
		actual := hex.EncodeToString(h.Sum(nil))
		if !strings.EqualFold(actual, localHashes[index]) {
			continue
		}
		parts = append(parts, meta.UploadPart{
			SessionID: session.ID, PartIndex: index, Size: targetSize, SHA256: actual,
			StorageKey: fmt.Sprintf(".xdrive-reuse/%d/%s/%06d", session.OwnerID, session.ID, index),
			Reused:     true, SourceStorageKey: source.StorageKey, SourceOffset: sourceOffset,
		})
	}
	return parts, nil
}

func expectedPartSize(session meta.UploadSession, index int) int64 {
	if index == session.ChunkCount-1 {
		return session.TotalSize - int64(index)*session.ChunkSize
	}
	return session.ChunkSize
}

func validSHA256(v string) bool {
	if len(v) != 64 {
		return false
	}
	_, err := hex.DecodeString(v)
	return err == nil
}

func (s *Server) StartUploadJanitor(ctx context.Context) {
	go func() {
		_ = s.cleanupExpiredUploads(ctx, 0)
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = s.cleanupExpiredUploads(ctx, 0)
			}
		}
	}()
}

func (s *Server) cleanupExpiredUploads(ctx context.Context, uid uint64) error {
	var sessions []meta.UploadSession
	q := s.DB.Where("status IN ? AND expires_at < ?", []string{meta.UploadStatusActive, meta.UploadStatusFinalized}, time.Now())
	if uid != 0 {
		q = q.Where("owner_id = ?", uid)
	}
	if err := q.Limit(128).Find(&sessions).Error; err != nil {
		return err
	}
	for _, session := range sessions {
		_ = s.abortUploadSessionData(ctx, session)
	}
	return nil
}

func (s *Server) abortUploadSessionData(ctx context.Context, session meta.UploadSession) error {
	var parts []meta.UploadPart
	if err := s.DB.Where("session_id = ?", session.ID).Find(&parts).Error; err != nil {
		return err
	}
	if err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("session_id = ?", session.ID).Delete(&meta.UploadPart{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND owner_id = ?", session.ID, session.OwnerID).Delete(&meta.UploadSession{}).Error
	}); err != nil {
		return err
	}
	for _, part := range parts {
		if !part.Reused {
			_ = s.Store.Delete(ctx, part.StorageKey)
		}
	}
	return nil
}

func (s *Server) nameExistsTx(tx *gorm.DB, uid, parent uint64, name string, except uint64) bool {
	var count int64
	q := tx.Model(&meta.Node{}).Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)", uid, parent, name)
	if except != 0 {
		q = q.Where("id <> ?", except)
	}
	return q.Count(&count).Error == nil && count > 0
}

type uploadPartSequence struct {
	ctx     context.Context
	store   storage.Store
	parts   []meta.UploadPart
	index   int
	current io.Reader
	closer  io.Closer
}

func (r *uploadPartSequence) Read(p []byte) (int, error) {
	for {
		if r.current == nil {
			if r.index >= len(r.parts) {
				return 0, io.EOF
			}
			part := r.parts[r.index]
			r.index++
			if part.Reused {
				f, err := r.store.Open(r.ctx, part.SourceStorageKey)
				if err != nil {
					return 0, err
				}
				r.current = io.NewSectionReader(f, part.SourceOffset, part.Size)
				r.closer = f
			} else {
				f, err := r.store.Open(r.ctx, part.StorageKey)
				if err != nil {
					return 0, err
				}
				r.current = f
				r.closer = f
			}
		}
		n, err := r.current.Read(p)
		if errors.Is(err, io.EOF) {
			closeErr := r.closeCurrent()
			if n > 0 {
				return n, nil
			}
			if closeErr != nil {
				return 0, closeErr
			}
			continue
		}
		return n, err
	}
}

func (r *uploadPartSequence) closeCurrent() error {
	var err error
	if r.closer != nil {
		err = r.closer.Close()
	}
	r.current = nil
	r.closer = nil
	return err
}

func (r *uploadPartSequence) Close() error {
	return r.closeCurrent()
}
