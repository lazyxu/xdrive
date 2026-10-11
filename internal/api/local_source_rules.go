package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// The generic owner-scoped Source DTO deliberately redacts ignore_rules.
// This narrow Agent-only read requires JWT + bound device credential + Root
// identity, and repeats the proof inside the same transaction as the read.
type localSourceIgnoreRulesDTO struct {
	SourceID    uint64 `json:"source_id"`
	Revision    uint64 `json:"revision"`
	IgnoreRules string `json:"ignore_rules"`
}

func (s *Server) getLocalSourceIgnoreRules(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	// requireLocalSourceExecutor() intentionally lets non-local Source
	// families through unchanged. They must NOT gain this private endpoint.
	if _, hasProof := c.Get(localSourceExecutorContextKey); !hasProof {
		fail(c, http.StatusForbidden, "owning device and authorized local Root required")
		return
	}
	var source meta.Source
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := s.requireLocalSourceProofTx(tx, c, id, "", false); err != nil {
			return err
		}
		if err := tx.Where("id = ? AND owner_id = ?", id, userID(c)).First(&source).Error; err != nil {
			return err
		}
		if !isLocalFolderPush(source) {
			return errLocalBindingTypeInvalid
		}
		if source.Status != meta.SourceStatusPaused {
			return errLocalBindingStateInvalid
		}
		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errLocalSourceExecutorTransactionUnauthorized):
			fail(c, http.StatusForbidden, "owning device and authorized local Root required")
		case errors.Is(err, errLocalBindingTypeInvalid):
			fail(c, http.StatusBadRequest, "local_folder push Source required")
		case errors.Is(err, errLocalBindingStateInvalid):
			fail(c, http.StatusConflict, "local Source must be paused")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "source not found")
		default:
			fail(c, http.StatusInternalServerError, "read local Source rules failed")
		}
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(source.Revision, 10)))
	c.JSON(http.StatusOK, localSourceIgnoreRulesDTO{
		SourceID: source.ID, Revision: source.Revision,
		IgnoreRules: source.IgnoreRules,
	})
}
