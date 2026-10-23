package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type localPushCommonDirectoryEnsureInput struct {
	ParentID  uint64 `json:"parent_id"`
	Name      string `json:"name"`
	CheckOnly bool   `json:"check_only,omitempty"`
}

// An idempotent metadata-only mkdir, separate from (and never replacing)
// the EXISTING ordinary /uploads byte/Finalize path. The requested parent
// must be a CURRENT descendant of the bound Source target under the same
// Owner/Device/Root/Source revision proof as file admission. No absolute OS
// path or user-provided Root identity is accepted from the Renderer.
func (s *Server) ensureLocalPushCommonDirectory(c *gin.Context) {
	if c == nil {
		return
	}
	c.Header("Cache-Control", "private, no-store")
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Push Source")
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	var input localPushCommonDirectoryEnsureInput
	if !decodePrivateLocalCommonUpload(c, &input) ||
		input.ParentID == 0 || meta.ValidateName(input.Name) != nil {
		fail(c, http.StatusBadRequest, "invalid local Push directory")
		return
	}
	proof, ok := localPushStageProof(c)
	if !ok || proof.SourceRevision != revision {
		fail(c, http.StatusConflict, "private local Push directory denied")
		return
	}
	deny := errLocalPushCommonUploadUnavailable
	var result meta.Node
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		owner, source, _, scopeErr := s.localPushOperationIntentScopeTx(
			tx, c, sourceID, revision, proof)
		if scopeErr != nil || source.TargetNodeID == nil {
			return deny
		}
		if requireNoLegacyLocalPushClaimsTx(tx, sourceID) != nil ||
			requireLocalPushCommonDescendantDirTx(tx,
				owner.ID, *source.TargetNodeID, input.ParentID) != nil {
			return deny
		}
		// Replaying a lost response resolves the same existing directory.
		// Refuse name-colliding files, different-case names and deleted
		// folders instead of repurposing a different target.
		var existing meta.Node
		readErr := tx.Clauses(clause.Locking{Strength: "SHARE", Options: "NOWAIT"}).
			Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)",
				owner.ID, input.ParentID, input.Name).Take(&existing).Error
		if readErr == nil {
			if existing.Type != meta.NodeTypeDir || existing.Name != input.Name ||
				existing.ParentID == nil || *existing.ParentID != input.ParentID {
				return deny
			}
			result = existing
			return c.Request.Context().Err()
		}
		if !errors.Is(readErr, gorm.ErrRecordNotFound) || input.CheckOnly {
			return deny
		}
		result = meta.Node{
			OwnerID: owner.ID, ParentID: &input.ParentID,
			Type: meta.NodeTypeDir, Name: input.Name,
		}
		if err := tx.Create(&result).Error; err != nil {
			return deny
		}
		return c.Request.Context().Err()
	})
	if err != nil || result.ID == 0 || result.ParentID == nil ||
		*result.ParentID != input.ParentID ||
		result.Name != input.Name || result.Type != meta.NodeTypeDir ||
		result.Revision == 0 {
		fail(c, http.StatusConflict, "private local Push directory unavailable")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, gin.H{
		"source_id": sourceID, "revision": revision,
		"node_id": result.ID, "parent_id": input.ParentID,
		"node_revision": result.Revision,
		"name":          result.Name, "type": result.Type,
		"backup_complete": false, "retirement_safe": false, "current_cas_verified": false,
	})
}
