package api

import (
	"errors"
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

var (
	errSynologyRootBindingDevice = errors.New("Synology root binding device unauthorized")
	errSynologyRootBindingSource = errors.New("Synology Push Source cannot bind this root")
	errSynologyRootBindingConflict = errors.New("Synology Push Source is already bound to a different root")
)

type synologySourceRootBindingDTO struct {
	SourceID uint64 `json:"source_id"`
	Revision uint64 `json:"revision"`
	Status string `json:"status"`
}

// bindSynologySourceRoot persists the source-agent's aggregate Personal/Shared
// filesystem fingerprint. The first binding pauses the Source and fences any
// in-flight run; a later different fingerprint is never silently accepted.
func (s *Server) bindSynologySourceRoot(c *gin.Context) {
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	var input struct {
		RootID string `json:"root_id"`
		RootFingerprint string `json:"root_fingerprint"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid Synology root binding")
		return
	}
	rootID, rootErr := uuid.Parse(strings.TrimSpace(input.RootID))
	fingerprint := strings.ToLower(strings.TrimSpace(input.RootFingerprint))
	if rootErr != nil || !validSHA256(fingerprint) {
		fail(c, http.StatusBadRequest, "invalid Synology root identity or fingerprint")
		return
	}
	deviceID, deviceErr := uuid.Parse(strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID")))
	if deviceErr != nil {
		fail(c, http.StatusForbidden, "registered Synology device credential required")
		return
	}

	var result synologySourceRootBindingDTO
	created := false
	var currentRevision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Match device revocation's lock order: Device, Source, then binding.
		var device meta.ClientDevice
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND platform = ?", deviceID.String(), userID(c), "synology").
			Take(&device).Error; err != nil {
			return errSynologyRootBindingDevice
		}
		if !clientDeviceIdentityCredentialMatches(device, c.GetHeader("X-XDrive-Device-Token")) {
			return errSynologyRootBindingDevice
		}
		var source meta.Source
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", sourceID, userID(c)).
			Take(&source).Error; err != nil {
			return err
		}
		currentRevision = source.Revision
		if source.Kind != synologySourceKind || source.Direction != meta.SourceDirectionPush ||
			source.DeviceID == nil || *source.DeviceID != device.ID ||
			!source.TargetManaged || source.TargetNodeID == nil ||
			source.Status == meta.SourceStatusArchived {
			return errSynologyRootBindingSource
		}
		var target meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				*source.TargetNodeID, source.OwnerID, meta.NodeTypeDir).
			Take(&target).Error; err != nil {
			return errSynologyRootBindingSource
		}
		var existing meta.LocalSourceBinding
		readErr := tx.Where("source_id = ? AND owner_id = ?", source.ID, source.OwnerID).Take(&existing).Error
		if readErr == nil {
			if existing.DeviceID != device.ID || existing.RootID != rootID.String() ||
				existing.RootFingerprint != fingerprint {
				return errSynologyRootBindingConflict
			}
			result = synologySourceRootBindingDTO{SourceID: source.ID, Revision: source.Revision, Status: source.Status}
			return nil
		}
		if !errors.Is(readErr, gorm.ErrRecordNotFound) {
			return readErr
		}
		if source.Revision != expected {
			return errRevisionConflict
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
		if err := tx.Model(&meta.Source{}).
			Where("id = ? AND owner_id = ? AND revision = ?", source.ID, source.OwnerID, source.Revision).
			Updates(map[string]any{
				"status": meta.SourceStatusPaused,
				"run_requested_at": nil,
				"revision": gorm.Expr("revision + 1"),
				"updated_at": now,
			}).Error; err != nil {
			return err
		}
		// Any pre-binding run is stale after the revision change. Request its
		// cancellation so it cannot continue with Device-only authority.
		if err := tx.Model(&meta.SyncRun{}).
			Where("source_id = ? AND status = ?", source.ID, meta.SyncRunStatusRunning).
			Update("cancel_requested_at", now).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
			Update("last_seen_at", now).Error; err != nil {
			return err
		}
		result = synologySourceRootBindingDTO{
			SourceID: source.ID, Revision: source.Revision + 1, Status: meta.SourceStatusPaused,
		}
		created = true
		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, errSynologyRootBindingDevice):
			fail(c, http.StatusForbidden, "Synology device credential invalid or revoked")
		case errors.Is(err, errSynologyRootBindingSource):
			fail(c, http.StatusConflict, "device-bound managed Synology Push Source required")
		case errors.Is(err, errSynologyRootBindingConflict):
			fail(c, http.StatusConflict, "Synology Source is already bound to a different root fingerprint; create a new Source after verifying the mounted volume")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "source not found")
		default:
			fail(c, http.StatusInternalServerError, "persist Synology root fingerprint failed")
		}
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("ETag", strconv.Quote(strconv.FormatUint(result.Revision, 10)))
	if created {
		c.JSON(http.StatusCreated, result)
	} else {
		c.JSON(http.StatusOK, result)
	}
}
