package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const iosPhotoSourceRunProofKey = "xdriveIOSPhotoSourceRunProof"

type iosPhotoSourceRunProof struct {
	ownerID        uint64
	deviceID       string
	sourceID       uint64
	targetNodeID   uint64
	sourceRevision uint64
}

var errIOSPhotoSourceRunUnauthorized = errors.New("iOS photo source run device proof rejected")

// Route all SourceRun writers through the existing executor policy, with a
// narrowly scoped iPhone proof for ios_photos and unchanged rules elsewhere.
func (s *Server) requireSourceRunExecutor() gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c.Param("id"))
		if !ok {
			fail(c, http.StatusBadRequest, "invalid source id")
			c.Abort()
			return
		}
		var source meta.Source
		if err := s.DB.WithContext(c.Request.Context()).
			Select("id", "owner_id", "kind", "direction").
			Where("id = ? AND owner_id = ?", id, userID(c)).Take(&source).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				fail(c, http.StatusNotFound, "source not found")
			} else {
				fail(c, http.StatusInternalServerError, "load source executor failed")
			}
			c.Abort()
			return
		}
		if source.Kind == meta.SourceKindLocalFolder ||
			(source.Kind == synologySourceKind && source.Direction == meta.SourceDirectionPush) {
			if !s.checkLocalSourceExecutor(c) {
				c.Abort()
				return
			}
		} else if source.Kind == meta.SourceKindIOSPhotos {
			if !s.checkIOSPhotoSourceRunExecutor(c, id) {
				c.Abort()
				return
			}
		} else if source.Kind == meta.SourceKindAndroidPhotos {
			if !s.checkAndroidPhotoSourceRunExecutor(c, id) {
				c.Abort()
				return
			}
		}
		c.Next()
	}
}

// Background PhotoKit work has no Web bearer by design. Admit SourceRun
// writes only through the separately revocable background grant and its exact
// registered iPhone/Source/Target binding. This middleware injects Owner scope
// only for the four SourceRun handlers on this dedicated route group.
func (s *Server) requireIOSPhotoBackgroundSourceRunExecutor() gin.HandlerFunc {
	return func(c *gin.Context) {
		sourceID, ok := parseID(c.Param("id"))
		if !ok {
			fail(c, http.StatusBadRequest, "invalid source id")
			c.Abort()
			return
		}
		grant, ok := iosPhotoBackgroundGrantFromContext(c)
		if !ok || grant.OwnerID == 0 || grant.ServerInstance != s.PWAOfflineInstanceID ||
			!iosPhotoGrantHasManagedTarget(grant) || grant.SourceID == nil ||
			grant.TargetNodeID == nil || *grant.SourceID != sourceID {
			fail(c, http.StatusForbidden, "managed iPhone background grant required for this Source")
			c.Abort()
			return
		}
		// Only this dedicated grant-protected group receives Owner scope.
		c.Set("userID", grant.OwnerID)
		if !s.checkIOSPhotoSourceRunExecutor(c, sourceID) {
			c.Abort()
			return
		}
		raw, exists := c.Get(iosPhotoSourceRunProofKey)
		proof, valid := raw.(iosPhotoSourceRunProof)
		if !exists || !valid || proof.ownerID != grant.OwnerID ||
			proof.deviceID != grant.DeviceID || proof.sourceID != *grant.SourceID ||
			proof.targetNodeID != *grant.TargetNodeID {
			fail(c, http.StatusForbidden, "background grant does not own this iPhone Source")
			c.Abort()
			return
		}
		c.Next()
	}
}

func (s *Server) checkIOSPhotoSourceRunExecutor(c *gin.Context, sourceID uint64) bool {
	uid := userID(c)
	var proof iosPhotoSourceRunProof
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		device, err := iosPhotoDestinationDeviceTx(c, tx, uid)
		if err != nil {
			return errIOSPhotoSourceRunUnauthorized
		}
		source, target, err := iosPhotoDestinationBindingTx(tx, device)
		if err != nil {
			return err
		}
		if source.ID != sourceID || source.OwnerID != uid ||
			source.TargetNodeID == nil || *source.TargetNodeID != target.ID {
			return errIOSPhotoSourceRunUnauthorized
		}
		proof = iosPhotoSourceRunProof{
			ownerID: uid, deviceID: device.ID, sourceID: source.ID,
			targetNodeID: target.ID, sourceRevision: source.Revision,
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, errIOSPhotoSourceRunUnauthorized) ||
			errors.Is(err, errIOSPhotoDestinationDenied) {
			fail(c, http.StatusForbidden, "verified iPhone and managed photo destination required")
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "iOS photo source not found")
		} else {
			fail(c, http.StatusInternalServerError, "verify iOS photo source executor failed")
		}
		return false
	}
	c.Set(iosPhotoSourceRunProofKey, proof)
	c.Header("Cache-Control", "private, no-store")
	return true
}

// Recheck device revocation and the exact Source/Node relationship in the
// same transaction as each SourceRun mutation. Device row is locked first.
func (s *Server) requireIOSPhotoSourceRunProofTx(tx *gorm.DB, c *gin.Context, sourceID uint64) error {
	raw, ok := c.Get(iosPhotoSourceRunProofKey)
	proof, valid := raw.(iosPhotoSourceRunProof)
	if !ok || !valid || proof.ownerID != userID(c) ||
		proof.sourceID != sourceID || proof.deviceID == "" ||
		proof.targetNodeID == 0 || proof.sourceRevision == 0 {
		return errIOSPhotoSourceRunUnauthorized
	}
	device, err := iosPhotoDestinationDeviceTx(c, tx, proof.ownerID)
	if err != nil || device.ID != proof.deviceID {
		return errIOSPhotoSourceRunUnauthorized
	}
	source, target, err := iosPhotoDestinationBindingTx(tx, device)
	if err != nil || source.ID != proof.sourceID ||
		source.Revision != proof.sourceRevision || target.ID != proof.targetNodeID ||
		source.TargetNodeID == nil || *source.TargetNodeID != target.ID ||
		!source.TargetManaged {
		return errIOSPhotoSourceRunUnauthorized
	}

	// A background task is admitted without an Owner bearer, so its grant must
	// be re-read under the same transaction as every SourceRun write. Lock
	// order remains Device -> Grant -> Owner/Root, matching grant rotation.
	if grant, hasGrant := iosPhotoBackgroundGrantFromContext(c); hasGrant {
		if grant.OwnerID != proof.ownerID || grant.DeviceID != proof.deviceID ||
			grant.ServerInstance != s.PWAOfflineInstanceID ||
			!iosPhotoGrantHasManagedTarget(grant) || grant.SourceID == nil ||
			grant.TargetNodeID == nil || *grant.SourceID != proof.sourceID ||
			*grant.TargetNodeID != proof.targetNodeID {
			return errIOSPhotoSourceRunUnauthorized
		}
		var liveGrant meta.IOSPhotoBackgroundGrant
		if err := tx.Clauses(clause.Locking{Strength: "SHARE", Options: "NOWAIT"}).
			Where("id = ? AND owner_id = ? AND device_id = ?", grant.ID, proof.ownerID, proof.deviceID).
			Take(&liveGrant).Error; err != nil {
			return errIOSPhotoSourceRunUnauthorized
		}
		var owner meta.User
		if err := tx.Clauses(clause.Locking{Strength: "SHARE", Options: "NOWAIT"}).
			Where("id = ?", proof.ownerID).Take(&owner).Error; err != nil {
			return errIOSPhotoSourceRunUnauthorized
		}
		var root meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "SHARE", Options: "NOWAIT"}).
			Where("id = ? AND owner_id = ? AND parent_id IS NULL", grant.RootNodeID, proof.ownerID).
			Take(&root).Error; err != nil {
			return errIOSPhotoSourceRunUnauthorized
		}
		if liveGrant.CredentialHash != grant.CredentialHash ||
			liveGrant.RootNodeID != grant.RootNodeID ||
			liveGrant.SourceID == nil || *liveGrant.SourceID != proof.sourceID ||
			liveGrant.TargetNodeID == nil || *liveGrant.TargetNodeID != proof.targetNodeID ||
			!iosPhotoGrantValid(liveGrant, device, owner, root,
				s.PWAOfflineInstanceID, time.Now().UTC()) {
			return errIOSPhotoSourceRunUnauthorized
		}
	}
	return nil
}
