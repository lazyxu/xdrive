package api

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
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
			Select("id", "owner_id", "kind").
			Where("id = ? AND owner_id = ?", id, userID(c)).Take(&source).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				fail(c, http.StatusNotFound, "source not found")
			} else {
				fail(c, http.StatusInternalServerError, "load source executor failed")
			}
			c.Abort()
			return
		}
		if source.Kind == meta.SourceKindLocalFolder {
			if !s.checkLocalSourceExecutor(c) {
				c.Abort()
				return
			}
		} else if source.Kind == meta.SourceKindIOSPhotos {
			if !s.checkIOSPhotoSourceRunExecutor(c, id) {
				c.Abort()
				return
			}
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
	return nil
}
