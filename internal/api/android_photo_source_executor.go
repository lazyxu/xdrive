package api

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// Android PhotoKit-equivalent SourceRun writes must reuse the Owner+Device+
// Source+Target contract. An identity-only device is never a Desktop executor.
const androidPhotoSourceRunProofKey = "xdriveAndroidPhotoSourceRunProof"

var errAndroidPhotoSourceRunUnauthorized = errors.New("Android photo SourceRun requires its registered Device and managed target")

type androidPhotoSourceRunProof struct {
	ownerID        uint64
	deviceID       string
	sourceID       uint64
	sourceRevision uint64
	targetID       uint64
}

func nativePhotoSourceRunKind(kind string) bool {
	return kind == meta.SourceKindIOSPhotos || kind == meta.SourceKindAndroidPhotos
}

// Middleware checks the authenticated user, registered unrevoked Android Device
// and the exact server-created managed Source/Target before admitting a request.
// A second check runs INSIDE the actual SyncRun transaction.
func (s *Server) checkAndroidPhotoSourceRunExecutor(c *gin.Context, sourceID uint64) bool {
	owner, ok := currentUser(c)
	if !ok || owner.ID == 0 || owner.DisabledAt != nil || owner.MustChangePassword {
		fail(c, http.StatusForbidden, "current Android photo Owner required")
		return false
	}
	var proof androidPhotoSourceRunProof
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		device, err := androidPhotoDestinationDeviceTx(c, tx, owner.ID)
		if err != nil {
			return err
		}
		source, target, err := androidPhotoDestinationBindingTx(tx, device)
		if err != nil {
			return err
		}
		if source.ID != sourceID || source.OwnerID != owner.ID ||
			source.TargetNodeID == nil || *source.TargetNodeID != target.ID {
			return errAndroidPhotoSourceRunUnauthorized
		}
		proof = androidPhotoSourceRunProof{
			ownerID: owner.ID, deviceID: device.ID, sourceID: source.ID,
			sourceRevision: source.Revision, targetID: target.ID,
		}
		return nil
	})
	if err != nil {
		fail(c, http.StatusForbidden, "verified Android photo Source/Device/Target required")
		return false
	}
	c.Set(androidPhotoSourceRunProofKey, proof)
	c.Header("Cache-Control", "private, no-store")
	return true
}

// Revalidate Device revocation, Source revision and managed Node identity
// inside every begin/progress/heartbeat/finish transaction. Preserve the
// device-first row-lock order of destination provisioning and revocation.
func (s *Server) requireAndroidPhotoSourceRunProofTx(
	tx *gorm.DB, c *gin.Context, sourceID uint64,
) error {
	raw, exists := c.Get(androidPhotoSourceRunProofKey)
	proof, valid := raw.(androidPhotoSourceRunProof)
	if tx == nil || !exists || !valid || proof.ownerID == 0 ||
		proof.ownerID != userID(c) || sourceID != proof.sourceID ||
		proof.deviceID == "" || proof.sourceRevision == 0 || proof.targetID == 0 {
		return errAndroidPhotoSourceRunUnauthorized
	}
	device, err := androidPhotoDestinationDeviceTx(c, tx, proof.ownerID)
	if err != nil || device.ID != proof.deviceID {
		return errAndroidPhotoSourceRunUnauthorized
	}
	source, target, err := androidPhotoDestinationBindingTx(tx, device)
	if err != nil || source.ID != proof.sourceID || source.OwnerID != proof.ownerID ||
		source.Revision != proof.sourceRevision || target.ID != proof.targetID ||
		source.TargetNodeID == nil || *source.TargetNodeID != proof.targetID ||
		!source.TargetManaged {
		return errAndroidPhotoSourceRunUnauthorized
	}
	return nil
}
