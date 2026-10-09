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
		Select("id", "owner_id", "kind", "direction", "revision").
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
	if source.Kind != meta.SourceKindLocalFolder {
		// Never widen the execution requirements of Yike/Synology/other Sources.
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
	if binding.RootID != rootID.String() || binding.RootFingerprint != fingerprint {
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
		DeviceID: device.ID, RootID: binding.RootID, SourceRevision: source.Revision,
	})
	return true
}

var errLocalSourceExecutorTransactionUnauthorized = errors.New("local source executor transaction authorization failed")

// requireLocalSourceExecutorTx repeats device and Root authorization under the
// SAME PostgreSQL transaction as the Source Run mutation. Revoke locks the
// device row before Sources; matching this order fences concurrent revocation.
func (s *Server) requireLocalSourceExecutorTx(tx *gorm.DB, c *gin.Context, sourceID uint64, runID string) error {
	raw, exists := c.Get(localSourceExecutorContextKey)
	if !exists {
		// Only local_folder Sources have this middleware-provided proof.
		return nil
	}
	proof, ok := raw.(localSourceExecutorProof)
	if !ok || proof.DeviceID == "" || proof.RootID == "" || proof.SourceRevision == 0 {
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
	if source.Kind != meta.SourceKindLocalFolder || source.Direction != meta.SourceDirectionPush ||
		source.Revision != proof.SourceRevision || source.Status != meta.SourceStatusActive {
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
