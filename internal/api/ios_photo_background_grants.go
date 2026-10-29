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

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// This grant is NOT a regular auth JWT or a Desktop Source/Root capability.
// Only dedicated /ios/photos/background-grants routes accept it. Existing
// /uploads, /nodes, /devices and admin routes remain under requireAuth().
const iosPhotoGrantTTL = 14 * 24 * time.Hour

var errIOSPhotoGrantDenied = errors.New("ios background photo grant denied")

func newIOSPhotoGrantSecret() (raw, hash string, err error) {
	var random [32]byte
	if _, err = rand.Read(random[:]); err != nil {
		return "", "", err
	}
	raw = base64.RawURLEncoding.EncodeToString(random[:])
	sum := sha256.Sum256([]byte(raw))
	return raw, hex.EncodeToString(sum[:]), nil
}

func validIOSPhotoGrantSecret(raw string) bool {
	if len(raw) != 43 {
		return false
	}
	b, err := base64.RawURLEncoding.DecodeString(raw)
	return err == nil && len(b) == 32 &&
		base64.RawURLEncoding.EncodeToString(b) == raw
}

func iosPhotoGrantValid(g meta.IOSPhotoBackgroundGrant, device meta.ClientDevice,
	user meta.User, root meta.Node, instance string, now time.Time) bool {
	return g.ID != "" && g.OwnerID != 0 && g.OwnerID == user.ID &&
		g.OwnerID == device.OwnerID && g.DeviceID == device.ID &&
		g.RootNodeID == root.ID && g.ServerInstance != "" &&
		g.ServerInstance == instance && g.SessionVersion > 0 &&
		g.SessionVersion == user.SessionVersion &&
		g.RevokedAt == nil && now.Before(g.ExpiresAt) &&
		device.Platform == "ios" && device.RevokedAt == nil &&
		user.DisabledAt == nil && !user.MustChangePassword &&
		root.ParentID == nil && root.DeletedAt == nil &&
		root.OwnerID == g.OwnerID && root.Type == meta.NodeTypeDir
}

func iosPhotoGrantDTO(grant meta.IOSPhotoBackgroundGrant) gin.H {
	return gin.H{
		"id": grant.ID,
		"device_id": grant.DeviceID,
		"root_node_id": grant.RootNodeID,
		"expires_at": grant.ExpiresAt,
		"revoked": grant.RevokedAt != nil,
	}
}

// The current logged-in Owner explicitly issues/rotates an independently
// revocable grant for one ALREADY registered iPhone. Possessing just the
// identity-only Device token cannot issue a grant.
func (s *Server) createIOSPhotoBackgroundGrant(c *gin.Context) {
	user, ok := currentUser(c)
	if !ok || user.ID == 0 || user.DisabledAt != nil ||
		user.MustChangePassword || s.PWAOfflineInstanceID == "" {
		fail(c, http.StatusForbidden, "current owner and server identity required")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var req struct {
		DeviceID string `json:"device_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid ios device grant request")
		return
	}
	devID, err := uuid.Parse(strings.TrimSpace(req.DeviceID))
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid device id")
		return
	}
	deviceToken := c.GetHeader("X-XDrive-Device-Token")
	raw, digest, err := newIOSPhotoGrantSecret()
	if err != nil {
		fail(c, http.StatusInternalServerError, "create private grant failed")
		return
	}
	now := time.Now().UTC()
	grant := meta.IOSPhotoBackgroundGrant{
		ID: uuid.NewString(), OwnerID: user.ID, DeviceID: devID.String(),
		SessionVersion: user.SessionVersion,
		ServerInstance: s.PWAOfflineInstanceID,
		CredentialHash: digest, CreatedAt: now, UpdatedAt: now,
		ExpiresAt: now.Add(iosPhotoGrantTTL),
	}
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var current meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", user.ID).Take(&current).Error; err != nil {
			return err
		}
		if current.DisabledAt != nil || current.MustChangePassword ||
			current.SessionVersion != user.SessionVersion {
			return errIOSPhotoGrantDenied
		}
		var device meta.ClientDevice
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", devID.String(), user.ID).
			Take(&device).Error; err != nil {
			return err
		}
		if device.Platform != "ios" ||
			!clientDeviceIdentityCredentialMatches(device, deviceToken) {
			return errIOSPhotoGrantDenied
		}
		var root meta.Node
		if err := tx.Where("owner_id = ? AND parent_id IS NULL AND deleted_at IS NULL AND type = ?",
			user.ID, meta.NodeTypeDir).Take(&root).Error; err != nil {
			return err
		}
		grant.RootNodeID = root.ID
		if err := tx.Model(&meta.IOSPhotoBackgroundGrant{}).
			Where("owner_id = ? AND device_id = ? AND revoked_at IS NULL",
				user.ID, device.ID).
			Updates(map[string]any{"revoked_at": now, "updated_at": now}).Error; err != nil {
			return err
		}
		return tx.Create(&grant).Error
	})
	if err != nil {
		if errors.Is(err, errIOSPhotoGrantDenied) ||
			errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusForbidden, "device or owner grant denied")
		} else {
			fail(c, http.StatusInternalServerError, "create private grant failed")
		}
		return
	}
	c.Header("Cache-Control", "private, no-store")
	result := iosPhotoGrantDTO(grant)
	// The raw random grant is returned ONCE. Only its digest is stored.
	// Never log, put in a URL, give to a WebView, or use as a regular bearer.
	result["grant_secret"] = raw
	c.JSON(http.StatusCreated, result)
}

// Device and grant are independent secrets. The grant cannot authenticate
// to any existing /uploads, /nodes, user, admin or SourceRun route.
func (s *Server) requireIOSPhotoBackgroundGrant() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := c.GetHeader("X-XDrive-IOS-Photo-Grant")
		deviceRaw := c.GetHeader("X-XDrive-Device-Token")
		deviceID, err := uuid.Parse(strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID")))
		if err != nil || !validIOSPhotoGrantSecret(raw) ||
			len(deviceRaw) < 32 || len(deviceRaw) > 256 ||
			s.PWAOfflineInstanceID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid ios photo grant"})
			return
		}
		sum := sha256.Sum256([]byte(raw))
		digest := hex.EncodeToString(sum[:])
		var grant meta.IOSPhotoBackgroundGrant
		err = s.DB.WithContext(c.Request.Context()).
			Where("credential_hash = ? AND device_id = ?", digest, deviceID.String()).
			Take(&grant).Error
		if err != nil || subtle.ConstantTimeCompare(
			[]byte(digest), []byte(grant.CredentialHash)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid ios photo grant"})
			return
		}
		var user meta.User
		if err := s.DB.WithContext(c.Request.Context()).
			Where("id = ?", grant.OwnerID).Take(&user).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid ios photo grant"})
			return
		}
		var device meta.ClientDevice
		if err := s.DB.WithContext(c.Request.Context()).
			Where("id = ? AND owner_id = ?", deviceID.String(), grant.OwnerID).
			Take(&device).Error; err != nil ||
			!clientDeviceIdentityCredentialMatches(device, deviceRaw) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid ios photo grant"})
			return
		}
		var root meta.Node
		if err := s.DB.WithContext(c.Request.Context()).
			Where("id = ? AND owner_id = ? AND parent_id IS NULL",
				grant.RootNodeID, grant.OwnerID).Take(&root).Error; err != nil ||
			!iosPhotoGrantValid(grant, device, user, root,
				s.PWAOfflineInstanceID, time.Now().UTC()) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid ios photo grant"})
			return
		}
		// Scope remains private, NEVER assign generic context userID/user.
		c.Set("iosPhotoBackgroundGrant", grant)
		c.Next()
	}
}

func iosPhotoBackgroundGrantFromContext(c *gin.Context) (meta.IOSPhotoBackgroundGrant, bool) {
	v, exists := c.Get("iosPhotoBackgroundGrant")
	g, ok := v.(meta.IOSPhotoBackgroundGrant)
	return g, exists && ok
}

// Only a scope proof. No UploadSession or PhotoKit side effects.
func (s *Server) proveIOSPhotoBackgroundGrant(c *gin.Context) {
	g, ok := iosPhotoBackgroundGrantFromContext(c)
	if !ok {
		fail(c, http.StatusUnauthorized, "invalid ios photo grant")
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, gin.H{
		"grant_id": g.ID, "owner_id": g.OwnerID,
		"device_id": g.DeviceID, "root_node_id": g.RootNodeID,
		"server_instance_id": g.ServerInstance, "expires_at": g.ExpiresAt,
		"upload_authorized": true, // ONLY the exact Owner-root iOS upload aliases
		"upload_path_base": "/api/v1/ios/photos/background"
	})
}

// A registered iOS device can rotate ONLY its still-valid restricted grant.
// Neither the device's identity token alone nor a revoked grant can renew.
func (s *Server) rotateIOSPhotoBackgroundGrant(c *gin.Context) {
	previous, ok := iosPhotoBackgroundGrantFromContext(c)
	if !ok {
		fail(c, http.StatusUnauthorized, "invalid ios photo grant")
		return
	}
	raw, digest, err := newIOSPhotoGrantSecret()
	if err != nil {
		fail(c, http.StatusInternalServerError, "rotate ios photo grant failed")
		return
	}
	now := time.Now().UTC()
	next := meta.IOSPhotoBackgroundGrant{
		ID: uuid.NewString(), OwnerID: previous.OwnerID,
		DeviceID: previous.DeviceID, RootNodeID: previous.RootNodeID,
		ServerInstance: previous.ServerInstance,
		SessionVersion: previous.SessionVersion, CredentialHash: digest,
		CreatedAt: now, UpdatedAt: now, ExpiresAt: now.Add(iosPhotoGrantTTL),
	}
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var device meta.ClientDevice
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", previous.DeviceID,
				previous.OwnerID).Take(&device).Error; err != nil {
			return err
		}
		if device.Platform != "ios" || !clientDeviceIdentityCredentialMatches(
			device, c.GetHeader("X-XDrive-Device-Token")) {
			return errIOSPhotoGrantDenied
		}
		result := tx.Model(&meta.IOSPhotoBackgroundGrant{}).
			Where("id = ? AND owner_id = ? AND revoked_at IS NULL AND expires_at > ?",
				previous.ID, previous.OwnerID, now).
			Updates(map[string]any{"revoked_at": now, "updated_at": now})
		if result.Error != nil { return result.Error }
		if result.RowsAffected != 1 { return errIOSPhotoGrantDenied }
		return tx.Create(&next).Error
	})
	if err != nil {
		fail(c, http.StatusForbidden, "ios photo grant rotation denied")
		return
	}
	c.Header("Cache-Control", "private, no-store")
	result := iosPhotoGrantDTO(next)
	result["grant_secret"] = raw
	c.JSON(http.StatusCreated, result)
}

// The Owner can revoke a LOST iPhone grant without possessing that iPhone's
// device secret. Device-wide revocation is also an independent hard fence.
func (s *Server) revokeIOSPhotoBackgroundGrant(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid grant id")
		return
	}
	now := time.Now().UTC()
	result := s.DB.WithContext(c.Request.Context()).
		Model(&meta.IOSPhotoBackgroundGrant{}).
		Where("id = ? AND owner_id = ? AND revoked_at IS NULL", id.String(), userID(c)).
		Updates(map[string]any{"revoked_at": now, "updated_at": now})
	if result.Error != nil {
		fail(c, http.StatusInternalServerError, "revoke ios photo grant failed")
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, gin.H{"revoked": true})
}

func (s *Server) listIOSPhotoBackgroundGrants(c *gin.Context) {
	var items []meta.IOSPhotoBackgroundGrant
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ?", userID(c)).
		Order("created_at DESC, id DESC").Limit(101).Find(&items).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list ios photo grants failed")
		return
	}
	more := len(items) > 100
	if more { items = items[:100] }
	out := make([]gin.H, 0, len(items))
	for _, grant := range items { out = append(out, iosPhotoGrantDTO(grant)) }
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, gin.H{"items": out, "has_more": more})
}
