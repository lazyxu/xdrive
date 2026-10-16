package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

const baiduMapJobRequestMaxBytes = 512

var (
	errMediaBaiduMapJobConflict         = errors.New("photo map index job changed")
	errMediaBaiduMapJobAuditUnavailable = errors.New("photo map index job audit unavailable")
)

// The public DTO NEVER contains a lease token, original GPS, derived GPS,
// AK, source revision, source path, provider URL or any private queue row.
// The release gate remains OFF even when an Owner has explicitly queued work.
type mediaBaiduMapJobDTO struct {
	Status          string `json:"status"`
	ConsentRevision uint64 `json:"consent_revision"`
	Attempts        uint32 `json:"attempts"`
	DispatchEnabled bool   `json:"dispatch_enabled"`
	ActivationState string `json:"activation_state"`
}

type mediaBaiduMapJobInput struct {
	ExpectedRevision *uint64 `json:"expected_revision"`
	Confirm          *bool   `json:"confirm"`
}

func mediaBaiduMapJobResponse(row *meta.BaiduPhotoMapIndexIntent) mediaBaiduMapJobDTO {
	dto := mediaBaiduMapJobDTO{
		Status: "not_queued", ActivationState: "blocked_pending_licence_and_provider_review",
	}
	if row != nil {
		dto.Status = row.Status
		dto.ConsentRevision = row.ConsentRevision
		dto.Attempts = row.Attempts
	}
	return dto
}

func mediaBaiduMapJobHeaders(c *gin.Context) {
	mediaBaiduConsentPrivateHeaders(c)
	c.Header("X-Content-Type-Options", "nosniff")
}

// Route id is the primary Gallery Node ID, NEVER the client-supplied Asset ID.
func (s *Server) getMediaBaiduMapIndexJob(c *gin.Context) {
	mediaBaiduMapJobHeaders(c)
	_, asset, ok := s.mediaBaiduConsentAsset(c, true)
	if !ok {
		return
	}
	var job meta.BaiduPhotoMapIndexIntent
	err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND asset_id = ?", userID(c), asset.ID).
		Take(&job).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusOK, mediaBaiduMapJobResponse(nil))
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "photo map index status unavailable")
		return
	}
	c.JSON(http.StatusOK, mediaBaiduMapJobResponse(&job))
}

func parseMediaBaiduMapJobRequest(c *gin.Context) (mediaBaiduMapJobInput, bool) {
	var input mediaBaiduMapJobInput
	contentType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || contentType != "application/json" {
		fail(c, http.StatusUnsupportedMediaType, "application/json required")
		return input, false
	}
	if c.Request.ContentLength > baiduMapJobRequestMaxBytes {
		fail(c, http.StatusRequestEntityTooLarge, "photo map index request too large")
		return input, false
	}
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, baiduMapJobRequestMaxBytes+1))
	if err != nil || len(raw) > baiduMapJobRequestMaxBytes {
		fail(c, http.StatusRequestEntityTooLarge, "photo map index request too large")
		return input, false
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if dec.Decode(&input) != nil {
		fail(c, http.StatusBadRequest, "invalid photo map index request")
		return input, false
	}
	var trailing any
	if dec.Decode(&trailing) != io.EOF ||
		input.ExpectedRevision == nil || *input.ExpectedRevision == 0 ||
		*input.ExpectedRevision == ^uint64(0) ||
		input.Confirm == nil || !*input.Confirm {
		fail(c, http.StatusBadRequest, "current consent revision and explicit confirmation required")
		return input, false
	}
	return input, true
}

// This endpoint persists an explicitly requested intent ONLY.
// No scheduler/worker or Baidu network request is triggered by HTTP 202.
func (s *Server) postMediaBaiduMapIndexJob(c *gin.Context) {
	mediaBaiduMapJobHeaders(c)
	if !s.mediaBaiduConsentWriteOrigin(c) {
		fail(c, http.StatusForbidden, "photo map index origin denied")
		return
	}
	input, valid := parseMediaBaiduMapJobRequest(c)
	if !valid {
		return
	}
	_, asset, ok := s.mediaBaiduConsentAsset(c, false)
	if !ok {
		return
	}
	actor, ok := currentUser(c)
	if !ok || actor.ID == 0 || actor.SessionVersion == 0 || actor.ID != userID(c) {
		fail(c, http.StatusUnauthorized, "current session required")
		return
	}
	var job meta.BaiduPhotoMapIndexIntent
	err := s.DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}).
		WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var current meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND session_version = ? AND disabled_at IS NULL AND must_change_password = ?",
				actor.ID, actor.SessionVersion, false).Take(&current).Error; err != nil {
			return errMediaBaiduMapJobConflict
		}
		if err := enqueueBaiduPhotoMapIndexIntent(c.Request.Context(), tx, current.ID,
			asset.ID, *input.ExpectedRevision); err != nil {
			return errMediaBaiduMapJobConflict
		}
		if err := tx.Where("owner_id = ? AND asset_id = ?", current.ID, asset.ID).
			Take(&job).Error; err != nil {
			return errMediaBaiduMapJobConflict
		}
		event := auditEventFromContext(c, "media.photo_map.index.enqueue",
			"photo_asset", strconv.FormatUint(asset.ID, 10), "",
			auditpkg.ResultSuccess, map[string]any{"consent_revision": job.ConsentRevision})
		uid := current.ID
		event.ActorUserID = &uid
		event.ActorUsername = current.Username
		event.ActorRole = current.Role
		if err := recordAuditTx(tx, event); err != nil {
			return errMediaBaiduMapJobAuditUnavailable
		}
		return nil
	})
	if errors.Is(err, errMediaBaiduMapJobAuditUnavailable) {
		fail(c, http.StatusInternalServerError, "photo map index audit unavailable; no change made")
		return
	}
	if err != nil {
		fail(c, http.StatusConflict, "photo map index consent or source changed")
		return
	}
	c.JSON(http.StatusAccepted, mediaBaiduMapJobResponse(&job))
}

// The If-Match CAS uses the QUEUED job's consent revision. An old client
// cannot cancel a replacement intent produced from a fresh permission grant.
func (s *Server) deleteMediaBaiduMapIndexJob(c *gin.Context) {
	mediaBaiduMapJobHeaders(c)
	if c.Request.ContentLength != 0 || len(c.Request.TransferEncoding) != 0 {
		fail(c, http.StatusBadRequest, "photo map index cancellation body must be empty")
		return
	}
	if !s.mediaBaiduConsentWriteOrigin(c) {
		fail(c, http.StatusForbidden, "photo map index origin denied")
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	_, asset, ok := s.mediaBaiduConsentAsset(c, true)
	if !ok {
		return
	}
	actor, ok := currentUser(c)
	if !ok || actor.ID == 0 || actor.SessionVersion == 0 || actor.ID != userID(c) {
		fail(c, http.StatusUnauthorized, "current session required")
		return
	}
	var job meta.BaiduPhotoMapIndexIntent
	err := s.DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}).
		WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var current meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND session_version = ? AND disabled_at IS NULL AND must_change_password = ?",
				actor.ID, actor.SessionVersion, false).Take(&current).Error; err != nil {
			return errMediaBaiduMapJobConflict
		}
		if err := tx.Where("owner_id = ? AND asset_id = ?", current.ID, asset.ID).
			Take(&job).Error; err != nil {
			return errMediaBaiduMapJobConflict
		}
		if job.ConsentRevision != revision || revision == 0 {
			return errMediaBaiduMapJobConflict
		}
		if err := cancelBaiduPhotoMapIndexIntent(c.Request.Context(), tx, current.ID, asset.ID); err != nil {
			return errMediaBaiduMapJobConflict
		}
		if err := tx.Where("owner_id = ? AND asset_id = ?", current.ID, asset.ID).
			Take(&job).Error; err != nil {
			return errMediaBaiduMapJobConflict
		}
		event := auditEventFromContext(c, "media.photo_map.index.cancel",
			"photo_asset", strconv.FormatUint(asset.ID, 10), "",
			auditpkg.ResultSuccess, map[string]any{"consent_revision": revision})
		uid := current.ID
		event.ActorUserID = &uid
		event.ActorUsername = current.Username
		event.ActorRole = current.Role
		if err := recordAuditTx(tx, event); err != nil {
			return errMediaBaiduMapJobAuditUnavailable
		}
		return nil
	})
	if errors.Is(err, errMediaBaiduMapJobAuditUnavailable) {
		fail(c, http.StatusInternalServerError, "photo map index audit unavailable; no change made")
		return
	}
	if err != nil {
		fail(c, http.StatusConflict, "photo map index job changed or unavailable")
		return
	}
	c.JSON(http.StatusOK, mediaBaiduMapJobResponse(&job))
}
