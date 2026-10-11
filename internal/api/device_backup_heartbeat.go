package api

import (
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

// Only a recently accepted, owner-and-device-credential authenticated
// heartbeat proves the Agent is observed online. Enrollment and LastSeenAt
// are NOT heartbeats; absence of a heartbeat means unknown, not offline.
const deviceBackupHeartbeatTTL = 150 * time.Second

var errDeviceHeartbeatUnauthorized = errors.New("device heartbeat not authorized")

func deviceBackupConnectionState(device meta.ClientDevice, now time.Time) string {
	if device.RevokedAt != nil || device.HeartbeatAt == nil {
		return "unknown"
	}
	age := now.Sub(*device.HeartbeatAt)
	if age < -5*time.Second {
		return "unknown"
	}
	if age <= deviceBackupHeartbeatTTL {
		return "online"
	}
	return "offline"
}

// heartbeatClientDevice is an isolated, credential-authenticated presence
// observation. It has NO Root proof, Source mutator, scheduler, run or transfer
// capability. Revocation and credential validation are rechecked under the
// same device row lock as the timestamp update.
func (s *Server) heartbeatClientDevice(c *gin.Context) {
	if c.Request.ContentLength != 0 || c.Request.URL.RawQuery != "" {
		fail(c, http.StatusBadRequest, "heartbeat accepts no body or query")
		return
	}
	id, err := uuid.Parse(strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID")))
	if err != nil {
		fail(c, http.StatusForbidden, "device credential invalid or revoked")
		return
	}
	token := c.GetHeader("X-XDrive-Device-Token")
	if len(token) < 32 || len(token) > 256 {
		fail(c, http.StatusForbidden, "device credential invalid or revoked")
		return
	}
	now := time.Now().UTC()
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var device meta.ClientDevice
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", id.String(), userID(c)).
			Take(&device).Error; err != nil {
			return err
		}
		if !clientDeviceCredentialMatches(device, token) {
			return errDeviceHeartbeatUnauthorized
		}
		result := tx.Model(&meta.ClientDevice{}).
			Where("id = ? AND owner_id = ? AND revoked_at IS NULL", device.ID, device.OwnerID).
			Updates(map[string]any{
				"heartbeat_at": now,
				"last_seen_at": now,
				"updated_at":   now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errDeviceHeartbeatUnauthorized
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) || errors.Is(err, errDeviceHeartbeatUnauthorized) {
			fail(c, http.StatusForbidden, "device credential invalid or revoked")
			return
		}
		fail(c, http.StatusInternalServerError, "device heartbeat failed")
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Status(http.StatusNoContent)
}
