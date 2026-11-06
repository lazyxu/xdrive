package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// localSourceExecutorProof is a stage-gated admission guard. It does not yet
// activate ordinary local folder Sources: a native Agent capability and
// transaction-bound proof/fencing are required before any run can start.
type localSourceExecutorProof struct {
	DeviceID       string
	RootID         string
	Platform       string
	SourceRevision uint64
}

const localSourceExecutorContextKey = "local_source_executor_proof"

func (s *Server) requireLocalSourceExecutor() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !s.checkLocalSourceExecutor(c) {
			c.Abort()
			return
		}
		c.Next()
	}
}

func (s *Server) checkLocalSourceExecutor(c *gin.Context) bool {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return false
	}
	var source meta.Source
	err := s.DB.WithContext(c.Request.Context()).
		Select("id", "owner_id", "kind", "direction", "revision", "device_id", "target_node_id", "target_managed").
		Where("id = ? AND owner_id = ?", id, userID(c)).
		Take(&source).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "source not found")
		} else {
			fail(c, http.StatusInternalServerError, "load source for executor authorization failed")
		}
		return false
	}
	if source.Kind == synologySourceKind && source.Direction == meta.SourceDirectionPush {
		// Every DSM Push Source must be registered to a Synology Device and
		// bound to the aggregate Personal/Shared Root fingerprint. There is no
		// owner-JWT or legacy unbound execution fallback.
		boundDeviceID, bound := meta.SourceDeviceID(source)
		if !bound {
			fail(c, http.StatusForbidden, "Synology Push Source must be bound to a registered device")
			return false
		}
		sourceID, proof, proofOK := currentSynologySourceProof(c)
		if !proofOK || sourceID != source.ID || proof.DeviceID != boundDeviceID ||
			proof.SourceRevision != source.Revision || !source.TargetManaged || source.TargetNodeID == nil {
			fail(c, http.StatusForbidden, "Synology Source root proof required or stale")
			return false
		}
		var device meta.ClientDevice
		if err := s.DB.WithContext(c.Request.Context()).
			Where("id = ? AND owner_id = ? AND platform = ?", proof.DeviceID, source.OwnerID, "synology").
			Take(&device).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				fail(c, http.StatusForbidden, "Synology source device not found")
			} else {
				fail(c, http.StatusInternalServerError, "load Synology source device failed")
			}
			return false
		}
		if !clientDeviceIdentityCredentialMatches(device, c.GetHeader("X-XDrive-Device-Token")) {
			fail(c, http.StatusForbidden, "Synology source device credential invalid or revoked")
			return false
		}
		var binding meta.LocalSourceBinding
		if err := s.DB.WithContext(c.Request.Context()).
			Where("source_id = ? AND owner_id = ? AND device_id = ?", source.ID, source.OwnerID, proof.DeviceID).
			Take(&binding).Error; err != nil ||
			binding.RootID != proof.RootID ||
			binding.RootFingerprint != strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint"))) {
			fail(c, http.StatusForbidden, "Synology Source root fingerprint is not bound")
			return false
		}
		var target meta.Node
		if err := s.DB.WithContext(c.Request.Context()).
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				*source.TargetNodeID, source.OwnerID, meta.NodeTypeDir).
			Take(&target).Error; err != nil {
			fail(c, http.StatusForbidden, "Synology source target is unavailable")
			return false
		}
		c.Set(localSourceExecutorContextKey, localSourceExecutorProof{
			DeviceID: device.ID, RootID: binding.RootID, Platform: "synology", SourceRevision: source.Revision,
		})
		return true
	}
	if source.Kind != meta.SourceKindLocalFolder {
		// Pull connectors and native PhotoKit routes have their own authority.
		return true
	}
	if source.Direction != meta.SourceDirectionPush {
		fail(c, http.StatusConflict, "local folder has invalid push direction")
		return false
	}
	deviceID, deviceErr := uuid.Parse(strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID")))
	rootID, rootErr := uuid.Parse(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-ID")))
	fingerprint := strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint")))
	if deviceErr != nil || rootErr != nil || len(fingerprint) != 64 {
		fail(c, http.StatusForbidden, "local source executor identity required")
		return false
	}
	var binding meta.LocalSourceBinding
	err = s.DB.WithContext(c.Request.Context()).
		Where("source_id = ? AND owner_id = ? AND device_id = ?",
			source.ID, source.OwnerID, deviceID.String()).
		Take(&binding).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusForbidden, "local source executor is not bound")
		} else {
			fail(c, http.StatusInternalServerError, "load local source executor binding failed")
		}
		return false
	}
	boundDeviceID, bound := meta.SourceDeviceID(source)
	if !bound || boundDeviceID != deviceID.String() ||
		binding.RootID != rootID.String() || binding.RootFingerprint != fingerprint {
		fail(c, http.StatusForbidden, "local source executor root mismatch")
		return false
	}
	var device meta.ClientDevice
	err = s.DB.WithContext(c.Request.Context()).
		Where("id = ? AND owner_id = ?", binding.DeviceID, source.OwnerID).
		Take(&device).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusForbidden, "local source executor device not found")
		} else {
			fail(c, http.StatusInternalServerError, "load local source executor device failed")
		}
		return false
	}
	if !clientDeviceCredentialMatches(device, c.GetHeader("X-XDrive-Device-Token")) {
		fail(c, http.StatusForbidden, "local source executor credential invalid or revoked")
		return false
	}
	c.Set(localSourceExecutorContextKey, localSourceExecutorProof{
		DeviceID: device.ID, RootID: binding.RootID, Platform: device.Platform, SourceRevision: source.Revision,
	})
	return true
}

var errLocalSourceExecutorTransactionUnauthorized = errors.New("local source executor transaction authorization failed")

// requireLocalSourceExecutorTx repeats device and Root authorization under the
// SAME PostgreSQL transaction as the Source Run mutation. Revoke locks the
// device row before Sources; matching this order fences concurrent revocation.
func (s *Server) requireLocalSourceExecutorTx(tx *gorm.DB, c *gin.Context, sourceID uint64, runID string) error {
	return s.requireLocalSourceProofTx(tx, c, sourceID, runID, true)
}

// Mutations on an already-bound local folder require the same device and Root
// proof as a run, but may occur while the Source is paused. In particular,
// unbind and delete cannot be authorized by the owner JWT alone. This helper
// must run before any Source row lock, to preserve revoke's device-first order.
func (s *Server) requireLocalSourceMutationTx(tx *gorm.DB, c *gin.Context, sourceID uint64) error {
	if _, hasProof := c.Get(localSourceExecutorContextKey); !hasProof {
		var source meta.Source
		if err := tx.Select("kind", "direction", "device_id").Where("id = ? AND owner_id = ?", sourceID, userID(c)).Take(&source).Error; err != nil {
			return err
		}
		if source.Kind == meta.SourceKindIOSPhotos {
			return s.requireIOSPhotoSourceRunProofTx(tx, c, sourceID)
		}
		if source.Kind == meta.SourceKindLocalFolder ||
			(source.Kind == synologySourceKind && source.Direction == meta.SourceDirectionPush) {
			return errLocalSourceExecutorTransactionUnauthorized
		}
		return nil
	}
	return s.requireLocalSourceProofTx(tx, c, sourceID, "", false)
}

// The shared proof check is intentionally stricter for an executing run:
// editing a paused Source is allowed only with owning-device proof, whereas
// active status is additionally required at every execution boundary.
func (s *Server) requireLocalSourceProofTx(tx *gorm.DB, c *gin.Context, sourceID uint64, runID string, requireActive bool) error {
	raw, exists := c.Get(localSourceExecutorContextKey)
	if !exists {
		// iOS Photos uses its own Owner+registered-device proof; it is never
		// admitted by the Desktop local-folder credential or by Owner JWT alone.
		var source meta.Source
		if err := tx.Select("kind", "direction").Where("id = ? AND owner_id = ?", sourceID, userID(c)).Take(&source).Error; err != nil {
			return err
		}
		if source.Kind == meta.SourceKindIOSPhotos {
			return s.requireIOSPhotoSourceRunProofTx(tx, c, sourceID)
		}
		if source.Kind == synologySourceKind && source.Direction == meta.SourceDirectionPush {
			return errLocalSourceExecutorTransactionUnauthorized
		}
		return nil
	}
	proof, ok := raw.(localSourceExecutorProof)
	if !ok || proof.DeviceID == "" || proof.SourceRevision == 0 {
		return errLocalSourceExecutorTransactionUnauthorized
	}
	if proof.Platform == "synology" {
		return s.requireSynologySourceProofTx(tx, c, sourceID, runID, proof, requireActive)
	}
	if proof.RootID == "" {
		return errLocalSourceExecutorTransactionUnauthorized
	}
	var device meta.ClientDevice
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ?", proof.DeviceID, userID(c)).
		First(&device).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errLocalSourceExecutorTransactionUnauthorized
		}
		return err
	}
	if !clientDeviceCredentialMatches(device, c.GetHeader("X-XDrive-Device-Token")) {
		return errLocalSourceExecutorTransactionUnauthorized
	}
	var source meta.Source
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ?", sourceID, userID(c)).
		First(&source).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errLocalSourceExecutorTransactionUnauthorized
		}
		return err
	}
	boundDeviceID, bound := meta.SourceDeviceID(source)
	if source.Kind != meta.SourceKindLocalFolder || source.Direction != meta.SourceDirectionPush ||
		!bound || boundDeviceID != proof.DeviceID ||
		source.Revision != proof.SourceRevision || (requireActive && source.Status != meta.SourceStatusActive) {
		return errLocalSourceExecutorTransactionUnauthorized
	}
	var binding meta.LocalSourceBinding
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("source_id = ? AND owner_id = ? AND device_id = ?", sourceID, userID(c), proof.DeviceID).
		First(&binding).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errLocalSourceExecutorTransactionUnauthorized
		}
		return err
	}
	if binding.RootID != proof.RootID ||
		binding.RootFingerprint != strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint"))) {
		return errLocalSourceExecutorTransactionUnauthorized
	}
	if runID != "" {
		var run meta.SyncRun
		if err := tx.Select("id", "source_id", "source_revision").
			Where("id = ? AND source_id = ?", runID, sourceID).First(&run).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errLocalSourceExecutorTransactionUnauthorized
			}
			return err
		}
		if run.SourceRevision != proof.SourceRevision {
			return errLocalSourceExecutorTransactionUnauthorized
		}
	}
	return nil
}

// requireSynologySourceProofTx keeps DSM Push on the identity-only device
// credential path. It never grants Desktop Agent or generic local Root rights.
func (s *Server) requireSynologySourceProofTx(
	tx *gorm.DB, c *gin.Context, sourceID uint64, runID string,
	proof localSourceExecutorProof, requireActive bool,
) error {
	_, err := requireSynologySourceProofTx(tx, c, sourceID, runID, proof, requireActive)
	return err
}
