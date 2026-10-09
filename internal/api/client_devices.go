package api

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type clientDeviceDTO struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Platform      string     `json:"platform"`
	ClientVersion string     `json:"client_version,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	LastSeenAt    *time.Time `json:"last_seen_at,omitempty"`
	RevokedAt     *time.Time `json:"revoked_at,omitempty"`
}

type registeredClientDeviceDTO struct {
	Device      clientDeviceDTO `json:"device"`
	DeviceToken string          `json:"device_token"`
}

func toClientDeviceDTO(device meta.ClientDevice) clientDeviceDTO {
	return clientDeviceDTO{
		ID: device.ID, Name: device.Name, Platform: device.Platform,
		ClientVersion: device.ClientVersion, CreatedAt: device.CreatedAt,
		LastSeenAt: device.LastSeenAt, RevokedAt: device.RevokedAt,
	}
}

func validDeviceDisplayName(name string) bool {
	if name == "" || name != strings.TrimSpace(name) || len([]byte(name)) > 128 || !utf8.ValidString(name) {
		return false
	}
	for _, r := range name {
		if r < 32 {
			return false
		}
	}
	return true
}

func validClientPlatform(platform string) bool {
	return platform == "windows" || platform == "linux" || platform == "darwin"
}

func deviceCredentialDigest(raw string) string {
	digest := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(digest[:])
}

func clientDeviceCredentialMatches(device meta.ClientDevice, raw string) bool {
	if device.RevokedAt != nil || len(raw) < 32 || len(raw) > 256 {
		return false
	}
	actual := deviceCredentialDigest(raw)
	return subtle.ConstantTimeCompare([]byte(device.CredentialHash), []byte(actual)) == 1
}

func (s *Server) registerClientDevice(c *gin.Context) {
	var request struct {
		Name          string `json:"name"`
		Platform      string `json:"platform"`
		ClientVersion string `json:"client_version"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		fail(c, http.StatusBadRequest, "invalid device request")
		return
	}
	request.Name = strings.TrimSpace(request.Name)
	request.Platform = strings.ToLower(strings.TrimSpace(request.Platform))
	request.ClientVersion = strings.TrimSpace(request.ClientVersion)
	if !validDeviceDisplayName(request.Name) || !validClientPlatform(request.Platform) ||
		len(request.ClientVersion) > 64 {
		fail(c, http.StatusBadRequest, "invalid device name, platform, or client version")
		return
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		fail(c, http.StatusInternalServerError, "generate device credential failed")
		return
	}
	rawToken := base64.RawURLEncoding.EncodeToString(secret)
	now := time.Now().UTC()
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: userID(c), Name: request.Name,
		Platform: request.Platform, ClientVersion: request.ClientVersion,
		CredentialHash: deviceCredentialDigest(rawToken),
		CreatedAt:      now, UpdatedAt: now,
	}
	if err := s.DB.WithContext(c.Request.Context()).Create(&device).Error; err != nil {
		fail(c, http.StatusInternalServerError, "register device failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusCreated, registeredClientDeviceDTO{
		Device: toClientDeviceDTO(device), DeviceToken: rawToken,
	})
}

func (s *Server) listClientDevices(c *gin.Context) {
	var devices []meta.ClientDevice
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ?", userID(c)).
		Order("created_at DESC, id DESC").Limit(101).Find(&devices).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list devices failed")
		return
	}
	hasMore := len(devices) > 100
	if hasMore {
		devices = devices[:100]
	}
	out := make([]clientDeviceDTO, 0, len(devices))
	for _, device := range devices {
		out = append(out, toClientDeviceDTO(device))
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"items": out, "has_more": hasMore})
}

func (s *Server) revokeClientDevice(c *gin.Context) {
	deviceID, err := uuid.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid device id")
		return
	}
	now := time.Now().UTC()
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var device meta.ClientDevice
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", deviceID.String(), userID(c)).
			First(&device).Error; err != nil {
			return err
		}
		if device.RevokedAt != nil {
			return nil
		}
		if err := tx.Model(&meta.ClientDevice{}).
			Where("id = ? AND owner_id = ? AND revoked_at IS NULL", device.ID, device.OwnerID).
			Updates(map[string]any{"revoked_at": now, "updated_at": now}).Error; err != nil {
			return err
		}
		var bindings []meta.LocalSourceBinding
		if err := tx.Where("owner_id = ? AND device_id = ?", device.OwnerID, device.ID).
			Order("source_id ASC").Find(&bindings).Error; err != nil {
			return err
		}
		for _, binding := range bindings {
			if err := tx.Model(&meta.Source{}).
				Where("id = ? AND owner_id = ? AND kind = ?", binding.SourceID, device.OwnerID, meta.SourceKindLocalFolder).
				Updates(map[string]any{
					"status": meta.SourceStatusPaused, "run_requested_at": nil,
					"revision": gorm.Expr("revision + 1"), "updated_at": now,
				}).Error; err != nil {
				return err
			}
			if err := tx.Model(&meta.SourceItem{}).Where("source_id = ?", binding.SourceID).
				Updates(map[string]any{
					"mirror_missing_full_scans": 0, "mirror_missing_since": nil,
				}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "device not found")
		} else {
			fail(c, http.StatusInternalServerError, "revoke device failed")
		}
		return
	}
	c.Status(http.StatusNoContent)
}
