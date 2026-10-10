package api

import (
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errLocalBindingAlreadyExists = errors.New("local source binding already exists")
	errLocalBindingDeviceInvalid = errors.New("local source device credential invalid")
	errLocalBindingStateInvalid  = errors.New("local source must be paused")
	errLocalBindingTypeInvalid   = errors.New("local source required")
)

type localSourceBindingDTO struct {
	SourceID uint64 `json:"source_id"`
	DeviceID string `json:"device_id"`
	RootID   string `json:"root_id"`
	Status   string `json:"status"`
}

func localBindingDTO(binding meta.LocalSourceBinding, device meta.ClientDevice) localSourceBindingDTO {
	status := "awaiting_executor"
	if device.RevokedAt != nil {
		status = "device_revoked"
	}
	return localSourceBindingDTO{
		SourceID: binding.SourceID, DeviceID: binding.DeviceID,
		RootID: binding.RootID, Status: status,
	}
}

func (s *Server) bindLocalSource(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	var req struct {
		DeviceID        string `json:"device_id"`
		RootID          string `json:"root_id"`
		RootFingerprint string `json:"root_fingerprint"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid local binding request")
		return
	}
	deviceID, deviceErr := uuid.Parse(strings.TrimSpace(req.DeviceID))
	rootID, rootErr := uuid.Parse(strings.TrimSpace(req.RootID))
	fingerprint := strings.ToLower(strings.TrimSpace(req.RootFingerprint))
	decoded, hashErr := hex.DecodeString(fingerprint)
	if deviceErr != nil || rootErr != nil || hashErr != nil || len(decoded) != 32 {
		fail(c, http.StatusBadRequest, "invalid local device or root identity")
		return
	}
	var dto localSourceBindingDTO
	created := false
	var currentRevision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Match revoke's lock ordering: device first, then Source. A remote Web
		// caller without the one-time client credential cannot bind any local root.
		var device meta.ClientDevice
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", deviceID.String(), userID(c)).
			First(&device).Error; err != nil {
			return errLocalBindingDeviceInvalid
		}
		if !clientDeviceCredentialMatches(device, c.GetHeader("X-XDrive-Device-Token")) {
			return errLocalBindingDeviceInvalid
		}
		var source meta.Source
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", id, userID(c)).
			First(&source).Error; err != nil {
			return err
		}
		currentRevision = source.Revision
		if source.Revision != expected {
			return errRevisionConflict
		}
		if source.Kind != meta.SourceKindLocalFolder || source.Direction != meta.SourceDirectionPush {
			return errLocalBindingTypeInvalid
		}
		if source.Status != meta.SourceStatusPaused {
			return errLocalBindingStateInvalid
		}
		var existing meta.LocalSourceBinding
		err := tx.Where("source_id = ? AND owner_id = ?", id, userID(c)).
			Take(&existing).Error
		if err == nil {
			if existing.DeviceID != device.ID || existing.RootID != rootID.String() ||
				existing.RootFingerprint != fingerprint {
				return errLocalBindingAlreadyExists
			}
			dto = localBindingDTO(existing, device)
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		now := time.Now().UTC()
		binding := meta.LocalSourceBinding{
			SourceID: source.ID, OwnerID: source.OwnerID, DeviceID: device.ID,
			RootID: rootID.String(), RootFingerprint: fingerprint,
			CreatedAt: now, UpdatedAt: now,
		}
		if err := tx.Create(&binding).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.Source{}).Where("id = ? AND owner_id = ?", source.ID, source.OwnerID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now}).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
			Update("last_seen_at", now).Error; err != nil {
			return err
		}
		dto = localBindingDTO(binding, device)
		created = true
		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, errLocalBindingDeviceInvalid):
			fail(c, http.StatusForbidden, "device credential invalid or revoked")
		case errors.Is(err, errLocalBindingAlreadyExists):
			fail(c, http.StatusConflict, "local source is already bound to another root")
		case errors.Is(err, errLocalBindingStateInvalid):
			fail(c, http.StatusConflict, "local source must be paused for binding")
		case errors.Is(err, errLocalBindingTypeInvalid):
			fail(c, http.StatusBadRequest, "local_folder push source required")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "source not found")
		default:
			fail(c, http.StatusInternalServerError, "bind local source failed")
		}
		return
	}
	c.Header("Cache-Control", "no-store")
	if created {
		c.JSON(http.StatusCreated, dto)
	} else {
		c.JSON(http.StatusOK, dto)
	}
}

func (s *Server) getLocalSourceBinding(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	source, err := s.ownedSource(userID(c), id)
	if err != nil {
		fail(c, http.StatusNotFound, "source not found")
		return
	}
	if source.Kind != meta.SourceKindLocalFolder {
		fail(c, http.StatusBadRequest, "local_folder source required")
		return
	}
	var binding meta.LocalSourceBinding
	if err := s.DB.WithContext(c.Request.Context()).
		Where("source_id = ? AND owner_id = ?", id, userID(c)).Take(&binding).Error; err != nil {
		fail(c, http.StatusNotFound, "local source is not bound")
		return
	}
	var device meta.ClientDevice
	if err := s.DB.WithContext(c.Request.Context()).
		Where("id = ? AND owner_id = ?", binding.DeviceID, userID(c)).Take(&device).Error; err != nil {
		fail(c, http.StatusNotFound, "bound device not found")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, localBindingDTO(binding, device))
}

func (s *Server) unbindLocalSource(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	var currentRevision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := s.requireLocalSourceMutationTx(tx, c, id); err != nil {
			return err
		}
		var source meta.Source
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", id, userID(c)).First(&source).Error; err != nil {
			return err
		}
		currentRevision = source.Revision
		if currentRevision != expected {
			return errRevisionConflict
		}
		if source.Kind != meta.SourceKindLocalFolder {
			return errLocalBindingTypeInvalid
		}
		if source.Status != meta.SourceStatusPaused {
			return errLocalBindingStateInvalid
		}
		var active int64
		if err := tx.Model(&meta.SyncRun{}).
			Where("source_id = ? AND status = ?", id, meta.SyncRunStatusRunning).
			Count(&active).Error; err != nil {
			return err
		}
		if active != 0 {
			return errSourceRunActive
		}
		result := tx.Where("source_id = ? AND owner_id = ?", id, userID(c)).
			Delete(&meta.LocalSourceBinding{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		now := time.Now().UTC()
		if err := tx.Model(&meta.Source{}).Where("id = ? AND owner_id = ?", id, userID(c)).
			Updates(map[string]any{
				"revision":         gorm.Expr("revision + 1"),
				"run_requested_at": nil, "updated_at": now,
			}).Error; err != nil {
			return err
		}
		return tx.Model(&meta.SourceItem{}).Where("source_id = ?", id).
			Updates(map[string]any{"mirror_missing_full_scans": 0, "mirror_missing_since": nil}).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, errLocalBindingTypeInvalid):
			fail(c, http.StatusBadRequest, "local_folder source required")
		case errors.Is(err, errLocalSourceExecutorTransactionUnauthorized):
			fail(c, http.StatusForbidden, "owning device and authorized local Root required")
		case errors.Is(err, errLocalBindingStateInvalid), errors.Is(err, errSourceRunActive):
			fail(c, http.StatusConflict, "local source must be paused with no active run")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "local source binding not found")
		default:
			fail(c, http.StatusInternalServerError, "unbind local source failed")
		}
		return
	}
	c.Status(http.StatusNoContent)
}
