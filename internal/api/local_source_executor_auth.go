package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
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
