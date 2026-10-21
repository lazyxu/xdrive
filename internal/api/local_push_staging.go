package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
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
	localPushStageMaxBytes = int64(64 << 20)
	localPushStageTTL      = 30 * time.Minute
	localPushStageReserved = "reserved"
	localPushStageWriting  = "writing"
	localPushStageReady    = "staged"
	localPushStageFailed   = "failed"
	localPushStageCanceled = "canceled"
	// Committed records only an INTERNAL single-file canonical SQL prototype,
	// not a successful device backup or SourceRun.
	localPushStageCommitted = "committed"
)

var errLocalPushStageConflict = errors.New("local push staging state changed")

type localPushStageRequest struct {
	CurrentSnapshotSHA256 string `json:"current_snapshot_sha256"`
	CurrentPathKey        string `json:"current_path_key"`
	SHA256                string `json:"sha256"`
	Size                  int64  `json:"size"`
}

type localPushStageDTO struct {
	StageID              string    `json:"stage_id"`
	SourceID             uint64    `json:"source_id"`
	Revision             uint64    `json:"revision"`
	Size                 int64     `json:"size"`
	Status               string    `json:"status"`
	ExpiresAt            time.Time `json:"expires_at"`
	ContentVerified      bool      `json:"content_verified"`
	CommitSupported      bool      `json:"commit_supported"`
	Authoritative        bool      `json:"authoritative"`
	MissingInferenceSafe bool      `json:"missing_inference_safe"`
}

func localPushStageResponse(row meta.LocalPushStaging) localPushStageDTO {
	return localPushStageDTO{
		StageID: row.StageID, SourceID: row.SourceID,
		Revision: row.SourceRevision, Size: row.TotalSize,
		Status: row.Status, ExpiresAt: row.ExpiresAt,
	}
}

func validLocalPushStageRequest(r localPushStageRequest) bool {
	return r.Size >= 0 && r.Size <= localPushStageMaxBytes &&
		validLocalEvidenceDigest(r.CurrentSnapshotSHA256) &&
		validLocalEvidenceDigest(r.CurrentPathKey) &&
		validLocalEvidenceDigest(r.SHA256)
}

func localPushStageStoreKey(stageID string) (string, error) {
	parsed, err := uuid.Parse(stageID)
	if err != nil || parsed.String() != stageID {
		return "", errLocalPushStageConflict
	}
	// Never let a caller choose a filesystem path or canonical CAS key.
	return storage.UploadStagingDir + "/localpush/" + parsed.String() + ".part", nil
}

func localPushStageProof(c *gin.Context) (localSourceExecutorProof, bool) {
	if c == nil || c.Request == nil {
		return localSourceExecutorProof{}, false
	}
	raw, exists := c.Get(localSourceExecutorContextKey)
	proof, ok := raw.(localSourceExecutorProof)
	return proof, exists && ok && proof.DeviceID != "" &&
		proof.RootID != "" && proof.SourceRevision > 0
}

// checkLocalPushStageScopeTx repeats owning-device credential and exact
// Source/Root/revision verification inside EVERY staging state transition.
// The owning JWT alone is never sufficient. It does not grant SourceRun or
// upload-finalize authority. Source must remain paused through this phase.
func (s *Server) checkLocalPushStageScopeTx(
	tx *gorm.DB, c *gin.Context, sourceID, revision uint64,
	proof localSourceExecutorProof,
) (meta.Source, error) {
	var source meta.Source
	if tx == nil || c == nil || c.Request == nil ||
		sourceID == 0 || revision == 0 {
		return source, errLocalPushStageConflict
	}
	bound, ok := localPushStageProof(c)
	if !ok || bound != proof || proof.SourceRevision != revision {
		return source, errLocalSourceExecutorTransactionUnauthorized
	}
	if err := s.requireLocalSourceProofTx(tx, c, sourceID, "", false); err != nil {
		return source, err
	}
	if err := tx.Select("id", "owner_id", "kind", "direction",
		"status", "sync_mode", "revision", "target_node_id").
		Where("id = ? AND owner_id = ?", sourceID, userID(c)).
		Take(&source).Error; err != nil {
		return source, err
	}
	if !isLocalFolderPush(source) || source.Status != meta.SourceStatusPaused ||
		source.Revision != revision || source.TargetNodeID == nil ||
		*source.TargetNodeID == 0 {
		return source, errLocalPushStageConflict
	}
	var target meta.Node
	if err := tx.Select("id").Where(
		"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
		*source.TargetNodeID, source.OwnerID, meta.NodeTypeDir,
	).Take(&target).Error; err != nil {
		return source, errLocalPushStageConflict
	}
	return source, c.Request.Context().Err()
}

func sameLocalPushStageScope(
	c *gin.Context, row meta.LocalPushStaging, source meta.Source,
	proof localSourceExecutorProof, stageID string,
) bool {
	return row.SourceID == source.ID && row.OwnerID == source.OwnerID &&
		row.SourceRevision == source.Revision && row.StageID == stageID &&
		row.DeviceID == proof.DeviceID && row.RootID == proof.RootID &&
		row.RootFingerprint == strings.ToLower(strings.TrimSpace(
			c.GetHeader("X-XDrive-Local-Root-Fingerprint"))) &&
		source.TargetNodeID != nil && row.TargetNodeID == *source.TargetNodeID &&
		time.Now().Before(row.ExpiresAt)
}

func failLocalPushStage(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errLocalSourceExecutorTransactionUnauthorized):
		fail(c, http.StatusForbidden, "owning device authorization required")
	case errors.Is(err, gorm.ErrRecordNotFound):
		fail(c, http.StatusNotFound, "local staging not found")
	case errors.Is(err, errRevisionConflict), errors.Is(err, errLocalPushStageConflict),
		errors.Is(err, errLocalBindingStateInvalid):
		fail(c, http.StatusConflict, "local staging no longer matches current Source")
	default:
		fail(c, http.StatusServiceUnavailable, "local staging unavailable")
	}
}

func localPushStagePath(c *gin.Context) (uint64, string, bool) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return 0, "", false
	}
	raw := strings.TrimSpace(c.Param("stageID"))
	parsed, err := uuid.Parse(raw)
	if err != nil || parsed.String() != raw {
		fail(c, http.StatusBadRequest, "invalid staging ID")
		return 0, "", false
	}
	return id, raw, true
}

// The only entry point to reserve a local Push TEMPORARY byte transfer.
// At most one currently active/ready record exists per Source. The requested
// hash/path key are untrusted selectors, NOT proof of native source bytes.
func (s *Server) createLocalPushStage(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return
	}
	proof, ok := localPushStageProof(c)
	if !ok {
		fail(c, http.StatusForbidden, "owning device authorization required")
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var req localPushStageRequest
	if err := decoder.Decode(&req); err != nil || !validLocalPushStageRequest(req) {
		fail(c, http.StatusBadRequest, "invalid bounded staging input")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "trailing staging input")
		return
	}
	if local, ok := s.Store.(*storage.Local); !ok || local == nil {
		fail(c, http.StatusServiceUnavailable, "native staging storage unavailable")
		return
	}
	if err := s.ensureStorageWriteCapacityWithReservations(
		c.Request.Context(), req.Size, "",
	); err != nil {
		fail(c, http.StatusServiceUnavailable, "staging capacity unavailable")
		return
	}

	var stage meta.LocalPushStaging
	created := false
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		source, err := s.checkLocalPushStageScopeTx(tx, c, sourceID, revision, proof)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		var old meta.LocalPushStaging
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id = ? AND owner_id = ?", sourceID, userID(c)).
			Take(&old).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		fingerprint := strings.ToLower(strings.TrimSpace(
			c.GetHeader("X-XDrive-Local-Root-Fingerprint")))
		if err == nil && now.Before(old.ExpiresAt) &&
			(old.Status == localPushStageReserved || old.Status == localPushStageWriting ||
				old.Status == localPushStageReady) {
			if !sameLocalPushStageScope(c, old, source, proof, old.StageID) ||
				old.CurrentSnapshotSHA256 != req.CurrentSnapshotSHA256 ||
				old.CurrentPathKey != req.CurrentPathKey ||
				old.ContentSHA256 != req.SHA256 || old.TotalSize != req.Size {
				return errLocalPushStageConflict
			}
			stage = old // exact idempotent reservation/status lookup
			return nil
		}
		stage = meta.LocalPushStaging{
			SourceID: sourceID, StageID: uuid.NewString(),
			OwnerID: userID(c), SourceRevision: revision,
			DeviceID: proof.DeviceID, RootID: proof.RootID,
			RootFingerprint: fingerprint, TargetNodeID: *source.TargetNodeID,
			CurrentSnapshotSHA256: req.CurrentSnapshotSHA256,
			CurrentPathKey:        req.CurrentPathKey,
			ContentSHA256:         req.SHA256, TotalSize: req.Size,
			Status: localPushStageReserved, ExpiresAt: now.Add(localPushStageTTL),
			CreatedAt: now, UpdatedAt: now,
		}
		created = true
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return tx.Create(&stage).Error
		}
		return tx.Model(&meta.LocalPushStaging{}).
			Where("source_id = ? AND stage_id = ?", sourceID, old.StageID).
			Updates(map[string]any{
				"stage_id": stage.StageID, "owner_id": stage.OwnerID,
				"source_revision": stage.SourceRevision, "device_id": stage.DeviceID,
				"root_id": stage.RootID, "root_fingerprint": stage.RootFingerprint,
				"target_node_id":          stage.TargetNodeID,
				"current_snapshot_sha256": stage.CurrentSnapshotSHA256,
				"current_path_key":        stage.CurrentPathKey,
				"content_sha256":          stage.ContentSHA256, "total_size": stage.TotalSize,
				"status": stage.Status, "expires_at": stage.ExpiresAt,
				"updated_at": now,
			}).Error
	})
	if err != nil {
		failLocalPushStage(c, err)
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	if created {
		c.JSON(http.StatusCreated, localPushStageResponse(stage))
	} else {
		c.JSON(http.StatusOK, localPushStageResponse(stage))
	}
}

func (s *Server) loadLocalPushStageTx(
	tx *gorm.DB, c *gin.Context, sourceID, revision uint64,
	proof localSourceExecutorProof, stageID string,
) (meta.LocalPushStaging, error) {
	var empty meta.LocalPushStaging
	source, err := s.checkLocalPushStageScopeTx(tx, c, sourceID, revision, proof)
	if err != nil {
		return empty, err
	}
	var stage meta.LocalPushStaging
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("source_id = ? AND stage_id = ? AND owner_id = ?",
			sourceID, stageID, userID(c)).Take(&stage).Error; err != nil {
		return empty, err
	}
	if !sameLocalPushStageScope(c, stage, source, proof, stageID) {
		return empty, errLocalPushStageConflict
	}
	return stage, nil
}

func (s *Server) getLocalPushStage(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, stageID, ok := localPushStagePath(c)
	if !ok {
		return
	}
	proof, ok := localPushStageProof(c)
	if !ok {
		fail(c, http.StatusForbidden, "owning device authorization required")
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	var stage meta.LocalPushStaging
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var err error
		stage, err = s.loadLocalPushStageTx(tx, c, sourceID, revision, proof, stageID)
		return err
	})
	if err != nil {
		failLocalPushStage(c, err)
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localPushStageResponse(stage))
}

func (s *Server) putLocalPushStageBytes(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, stageID, ok := localPushStagePath(c)
	if !ok {
		return
	}
	proof, ok := localPushStageProof(c)
	if !ok {
		fail(c, http.StatusForbidden, "owning device authorization required")
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	local, ok := s.Store.(*storage.Local)
	if !ok || local == nil {
		fail(c, http.StatusServiceUnavailable, "native staging storage unavailable")
		return
	}
	var stage meta.LocalPushStaging
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var err error
		stage, err = s.loadLocalPushStageTx(tx, c, sourceID, revision, proof, stageID)
		if err != nil {
			return err
		}
		if stage.Status != localPushStageReserved {
			return errLocalPushStageConflict
		}
		result := tx.Model(&meta.LocalPushStaging{}).
			Where("source_id = ? AND stage_id = ? AND status = ?",
				sourceID, stageID, localPushStageReserved).
			Update("status", localPushStageWriting)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errLocalPushStageConflict
		}
		return nil
	})
	if err != nil {
		failLocalPushStage(c, err)
		return
	}
	key, err := localPushStageStoreKey(stageID)
	if err != nil {
		failLocalPushStage(c, err)
		return
	}
	staged := false
	defer func() {
		if staged {
			return
		}
		// The request context may already be cancelled; best-effort storage
		// cleanup uses an independent short context. Any escaped temporary
		// object is orphaned, noncanonical and eligible for janitor cleanup.
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = local.Delete(cleanupCtx, key)
		_ = s.DB.WithContext(cleanupCtx).Model(&meta.LocalPushStaging{}).
			Where("source_id = ? AND stage_id = ? AND status = ?",
				sourceID, stageID, localPushStageWriting).
			Update("status", localPushStageFailed).Error
	}()
	if c.Request.ContentLength > stage.TotalSize ||
		(c.Request.ContentLength >= 0 && c.Request.ContentLength != stage.TotalSize) {
		fail(c, http.StatusBadRequest, "staging byte count differs from reservation")
		return
	}
	// A partial or oversized request never becomes a CAS object. One extra
	// byte is admitted only to DETECT overflow, then rejected and deleted.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, stage.TotalSize+1)
	hash := sha256.New()
	count, err := local.Put(c.Request.Context(), key, io.TeeReader(c.Request.Body, hash))
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "temporary native staging write interrupted")
		return
	}
	if count != stage.TotalSize ||
		hex.EncodeToString(hash.Sum(nil)) != stage.ContentSHA256 {
		fail(c, http.StatusConflict, "temporary staging content does not match reservation")
		return
	}
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		current, err := s.loadLocalPushStageTx(tx, c, sourceID, revision, proof, stageID)
		if err != nil {
			return err
		}
		if current.Status != localPushStageWriting ||
			current.ContentSHA256 != stage.ContentSHA256 ||
			current.TotalSize != stage.TotalSize ||
			current.CurrentSnapshotSHA256 != stage.CurrentSnapshotSHA256 ||
			current.CurrentPathKey != stage.CurrentPathKey {
			return errLocalPushStageConflict
		}
		result := tx.Model(&meta.LocalPushStaging{}).
			Where("source_id = ? AND stage_id = ? AND status = ?",
				sourceID, stageID, localPushStageWriting).
			Update("status", localPushStageReady)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errLocalPushStageConflict
		}
		return c.Request.Context().Err()
	})
	if err != nil {
		failLocalPushStage(c, err)
		return
	}
	staged = true
	stage.Status = localPushStageReady
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localPushStageResponse(stage))
}

func (s *Server) cancelLocalPushStage(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, stageID, ok := localPushStagePath(c)
	if !ok {
		return
	}
	proof, ok := localPushStageProof(c)
	if !ok {
		fail(c, http.StatusForbidden, "owning device authorization required")
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	local, ok := s.Store.(*storage.Local)
	if !ok || local == nil {
		fail(c, http.StatusServiceUnavailable, "native staging storage unavailable")
		return
	}
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Quota writers lock User before Device/Source/CAS/Stage. Take the same
		// User row FIRST, so a cancellation does not invert their lock order.
		var owner meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", userID(c)).Take(&owner).Error; err != nil {
			return err
		}
		stage, err := s.loadLocalPushStageTx(tx, c, sourceID, revision, proof, stageID)
		if err != nil {
			return err
		}
		if stage.Status == localPushStageWriting || stage.Status == localPushStageCommitted {
			return errLocalPushStageConflict
		}
		// A live or historical quota reservation is private to this EXACT
		// immutable Stage generation. A foreign/mismatched record is not
		// safe to release even when the device JWT is otherwise valid.
		var hold meta.LocalPushQuotaHold
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("stage_id = ?", stageID).Take(&hold).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		found := err == nil
		if found && !sameLocalPushQuotaHold(hold, stage) {
			return errLocalPushStageConflict
		}
		if err := tx.Model(&meta.LocalPushStaging{}).
			Where("source_id = ? AND stage_id = ?", sourceID, stageID).
			Update("status", localPushStageCanceled).Error; err != nil {
			return err
		}
		if found && hold.ReleasedAt == nil {
			// Commit Stage cancellation AND quota release together. An
			// expired hold is still marked released for audit; it already
			// stopped consuming quota via the expiry predicate.
			now := time.Now().UTC()
			return tx.Model(&meta.LocalPushQuotaHold{}).
				Where("stage_id = ? AND owner_id = ? AND released_at IS NULL",
					stageID, stage.OwnerID).
				Update("released_at", now).Error
		}
		return nil
	})
	if err != nil {
		failLocalPushStage(c, err)
		return
	}
	key, err := localPushStageStoreKey(stageID)
	if err == nil {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = local.Delete(cleanupCtx, key)
	}
	c.Status(http.StatusNoContent)
}
