package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// APNs is only an advisory wake hint. Registering a token never starts an
// upload or grants access to Owner Files, CAS or another device.
const iosPhotoAPNSCredentialKindPrefix = "ios-photo-apns-device:"

type iosPhotoAPNSTokenRequest struct {
	DeviceToken string `json:"device_token"`
	Environment string `json:"environment"`
}

// APNs tokens are opaque; never assume they are exactly 32 bytes.
// Bounds protect JSON decoding and ciphertext storage, not token semantics.
func validIOSPhotoAPNSToken(token string) bool {
	if len(token) < 32 || len(token) > 512 || len(token)%2 != 0 ||
		strings.ToLower(token) != token {
		return false
	}
	decoded, err := hex.DecodeString(token)
	return err == nil && len(decoded) >= 16 && len(decoded) <= 256
}

func validIOSPhotoAPNSEnvironment(environment string) bool {
	return environment == "development" || environment == "production"
}

// The middleware already proves both independently revocable secrets. The
// transaction rechecks grant, registered device, Owner/Root and precise Source
// binding at persistence time, including concurrent revoke/target changes.
func (s *Server) iosPhotoAPNSLiveGrantTx(c *gin.Context, tx *gorm.DB,
	expected meta.IOSPhotoBackgroundGrant) (meta.IOSPhotoBackgroundGrant, error) {
	if !iosPhotoGrantHasManagedTarget(expected) {
		return meta.IOSPhotoBackgroundGrant{}, errIOSPhotoGrantDenied
	}
	var live meta.IOSPhotoBackgroundGrant
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ? AND device_id = ? AND revoked_at IS NULL AND expires_at > ?",
			expected.ID, expected.OwnerID, expected.DeviceID, time.Now().UTC()).
		Take(&live).Error; err != nil {
		return live, err
	}
	if live.SessionVersion != expected.SessionVersion ||
		live.ServerInstance != expected.ServerInstance ||
		!iosPhotoGrantHasManagedTarget(live) ||
		*live.SourceID != *expected.SourceID ||
		*live.TargetNodeID != *expected.TargetNodeID {
		return live, errIOSPhotoGrantDenied
	}
	var device meta.ClientDevice
	if err := tx.Where("id = ? AND owner_id = ?", live.DeviceID, live.OwnerID).
		Take(&device).Error; err != nil {
		return live, err
	}
	if device.Platform != "ios" || device.RevokedAt != nil ||
		!clientDeviceIdentityCredentialMatches(device, c.GetHeader("X-XDrive-Device-Token")) {
		return live, errIOSPhotoGrantDenied
	}
	var owner meta.User
	if err := tx.Where("id = ?", live.OwnerID).Take(&owner).Error; err != nil {
		return live, err
	}
	var root meta.Node
	if err := tx.Where("id = ? AND owner_id = ? AND parent_id IS NULL",
		live.RootNodeID, live.OwnerID).Take(&root).Error; err != nil {
		return live, err
	}
	if !iosPhotoGrantValid(live, device, owner, root,
		s.PWAOfflineInstanceID, time.Now().UTC()) {
		return live, errIOSPhotoGrantDenied
	}
	source, target, err := iosPhotoDestinationBindingTx(tx, device)
	if err != nil || source.ID != *live.SourceID || target.ID != *live.TargetNodeID {
		return live, errIOSPhotoGrantDenied
	}
	return live, nil
}

func (s *Server) putIOSPhotoAPNSToken(c *gin.Context) {
	grant, ok := iosPhotoBackgroundGrantFromContext(c)
	if !ok || !iosPhotoGrantHasManagedTarget(grant) {
		fail(c, http.StatusForbidden, "valid managed ios photo grant required")
		return
	}
	if s.ConnectorSecrets == nil {
		// Never store raw APNs tokens if server encryption is unavailable.
		fail(c, http.StatusServiceUnavailable, "private APNs token encryption unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var request iosPhotoAPNSTokenRequest
	if err := decoder.Decode(&request); err != nil ||
		!validIOSPhotoAPNSToken(request.DeviceToken) ||
		!validIOSPhotoAPNSEnvironment(request.Environment) {
		fail(c, http.StatusBadRequest, "invalid native APNs registration")
		return
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		fail(c, http.StatusBadRequest, "invalid APNs registration request")
		return
	}

	// Only a versioned AEAD ciphertext and digest reach PostgreSQL.
	plaintext := []byte(request.DeviceToken)
	defer clear(plaintext)
	version, ciphertext, err := s.ConnectorSecrets.Seal(
		*grant.SourceID, iosPhotoAPNSCredentialKindPrefix+grant.DeviceID, plaintext)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "private APNs token encryption unavailable")
		return
	}
	digest := sha256.Sum256(plaintext)
	now := time.Now().UTC()
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		live, err := s.iosPhotoAPNSLiveGrantTx(c, tx, grant)
		if err != nil {
			return err
		}
		// Re-registering the same token must not erase the last-sent throttle.
		// Only a genuinely rotated token is eligible for a new hint.
		var lastSent *time.Time
		if live.APNSTokenDigest == hex.EncodeToString(digest[:]) {
			lastSent = live.APNSLastSentAt
		}
		return tx.Model(&meta.IOSPhotoBackgroundGrant{}).
			Where("id = ? AND owner_id = ? AND revoked_at IS NULL", live.ID, live.OwnerID).
			Updates(map[string]any{
				"apns_token_ciphertext": ciphertext,
				"apns_key_version": version,
				"apns_token_digest": hex.EncodeToString(digest[:]),
				"apns_environment": request.Environment,
				"apns_registered_at": now,
				"apns_last_sent_at": lastSent,
				"updated_at": now,
			}).Error
	})
	if err != nil {
		if errors.Is(err, errIOSPhotoGrantDenied) || errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusForbidden, "APNs registration scope revoked")
		} else {
			fail(c, http.StatusServiceUnavailable, "APNs registration unavailable")
		}
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Status(http.StatusNoContent)
}

func (s *Server) deleteIOSPhotoAPNSToken(c *gin.Context) {
	grant, ok := iosPhotoBackgroundGrantFromContext(c)
	if !ok {
		fail(c, http.StatusUnauthorized, "invalid native photo grant")
		return
	}
	now := time.Now().UTC()
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		live, err := s.iosPhotoAPNSLiveGrantTx(c, tx, grant)
		if err != nil {
			return err
		}
		return tx.Model(&meta.IOSPhotoBackgroundGrant{}).
			Where("id = ? AND owner_id = ?", live.ID, live.OwnerID).
			Updates(map[string]any{
				"apns_token_ciphertext": nil,
				"apns_key_version": 0,
				"apns_token_digest": "",
				"apns_environment": "",
				"apns_registered_at": nil,
				"apns_last_sent_at": nil,
				"updated_at": now,
			}).Error
	})
	if err != nil {
		if errors.Is(err, errIOSPhotoGrantDenied) || errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusForbidden, "APNs grant revoked")
		} else {
			fail(c, http.StatusServiceUnavailable, "APNs revocation unavailable")
		}
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Status(http.StatusNoContent)
}
