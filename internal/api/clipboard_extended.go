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

func clipboardVisibleToDevice(db *gorm.DB, deviceID string) *gorm.DB {
	if deviceID == "" {
		return db.Where("(target_device_id = '' OR target_device_id IS NULL)")
	}
	return db.Where("(target_device_id = '' OR target_device_id IS NULL OR target_device_id = ?)", deviceID)
}

// This is a conjunctive Owner + installation identity proof, never an
// independent authorization for a device token alone. Missing headers only
// permit ordinary broadcast text. Revoked Clipboard keys lose targeted reads.
func (s *Server) clipboardVerifiedDevice(c *gin.Context, owner uint64) (string, bool) {
	deviceID := strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID"))
	token := c.GetHeader("X-XDrive-Device-Token")
	if deviceID == "" && token == "" {
		return "", true
	}
	parsed, err := uuid.Parse(deviceID)
	if err != nil || parsed.String() != deviceID || token == "" {
		return "", false
	}
	db := s.DB.WithContext(c.Request.Context())
	var device meta.ClientDevice
	if db.Where("owner_id = ? AND id = ? AND revoked_at IS NULL", owner, deviceID).
		Take(&device).Error != nil || !clientDeviceIdentityCredentialMatches(device, token) {
		return "", false
	}
	var key meta.ClipboardDeviceKey
	if db.Where("owner_id = ? AND device_id = ? AND revoked_at IS NULL", owner, deviceID).
		Take(&key).Error != nil {
		return "", true
	}
	return deviceID, true
}

func (s *Server) clipboardValidateTargetAndNode(db *gorm.DB, owner uint64, req clipboardWriteRequest) error {
	if req.TargetDeviceID != "" {
		var key meta.ClipboardDeviceKey
		var device meta.ClientDevice
		if db.Where("owner_id = ? AND device_id = ? AND revoked_at IS NULL", owner, req.TargetDeviceID).
			Take(&key).Error != nil ||
			db.Where("owner_id = ? AND id = ? AND revoked_at IS NULL", owner, req.TargetDeviceID).
				Take(&device).Error != nil {
			return errClipboardForbidden
		}
	}
	if req.NodeID > 0 {
		// The original must already have finished the normal UploadSession/
		// CAS path. Clipboard carries only an Owner-scoped Node reference.
		var node meta.Node
		if db.Where(
			"id = ? AND owner_id = ? AND deleted_at IS NULL AND trash_root_id IS NULL AND type = ?",
			req.NodeID, owner, "file",
		).Take(&node).Error != nil {
			return errClipboardForbidden
		}
		var original meta.File
		if db.Where("node_id = ? AND storage_key <> ''", node.ID).Take(&original).Error != nil {
			return errClipboardForbidden
		}
	}
	return nil
}

// The device grant requires live Owner authentication and a registered
// installation token. Cryptographic keys are not created or exchanged.
func (s *Server) enrollClipboardDeviceKey(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	owner := userID(c)
	deviceID := strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID"))
	token := c.GetHeader("X-XDrive-Device-Token")
	parsed, err := uuid.Parse(deviceID)
	if owner == 0 || err != nil || parsed.String() != deviceID || token == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "current Owner device proof required"})
		return
	}
	db := s.DB.WithContext(c.Request.Context())
	var device meta.ClientDevice
	if db.Where("owner_id = ? AND id = ? AND revoked_at IS NULL", owner, deviceID).
		Take(&device).Error != nil || !clientDeviceIdentityCredentialMatches(device, token) {
		c.JSON(http.StatusForbidden, gin.H{"error": "device credential invalid"})
		return
	}
	now := time.Now().UTC()
	proposed := meta.ClipboardDeviceKey{OwnerID: owner, DeviceID: deviceID,
		PublicKey: "", CreatedAt: now, UpdatedAt: now}
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&proposed).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "device enrollment unavailable"})
		return
	}
	var stored meta.ClipboardDeviceKey
	if db.Where("owner_id = ? AND device_id = ?", owner, deviceID).Take(&stored).Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "device enrollment unavailable"})
		return
	}
	if stored.RevokedAt != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "device authorization revoked"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"device_id": stored.DeviceID})
}

func (s *Server) listClipboardDevices(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	owner := userID(c)
	if owner == 0 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	db := s.DB.WithContext(c.Request.Context())
	var keys []meta.ClipboardDeviceKey
	if db.Where("owner_id = ? AND revoked_at IS NULL", owner).
		Order("device_id").Limit(101).Find(&keys).Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "devices unavailable"})
		return
	}
	if len(keys) > 100 {
		c.JSON(http.StatusConflict, gin.H{"error": "device list too large"})
		return
	}
	result := make([]gin.H, 0, len(keys))
	for _, key := range keys {
		var device meta.ClientDevice
		err := db.Where("owner_id = ? AND id = ? AND revoked_at IS NULL", owner, key.DeviceID).
			Take(&device).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "devices unavailable"})
			return
		}
		result = append(result, gin.H{
			"device_id": key.DeviceID, "name": device.Name,
			"platform": device.Platform,
		})
	}
	c.JSON(http.StatusOK, gin.H{"devices": result})
}

func (s *Server) revokeClipboardDeviceKey(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	owner := userID(c)
	deviceID, err := uuid.Parse(c.Param("id"))
	if owner == 0 || err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid device"})
		return
	}
	now := time.Now().UTC()
	result := s.DB.WithContext(c.Request.Context()).Model(&meta.ClipboardDeviceKey{}).
		Where("owner_id = ? AND device_id = ? AND revoked_at IS NULL", owner, deviceID.String()).
		Update("revoked_at", now)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "revoke unavailable"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "device unavailable"})
		return
	}
	c.Status(http.StatusNoContent)
}
