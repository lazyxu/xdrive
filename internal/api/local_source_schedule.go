package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// Only the bound Agent sees a pending schedule. The ordinary Source DTO and
// remote-device projection deliberately omit these local configuration fields.
type localSourceScheduleDTO struct {
	SourceID           uint64 `json:"source_id"`
	Revision           uint64 `json:"revision"`
	ScheduleType       string `json:"schedule_type"`
	ScheduleExpression string `json:"schedule_expression"`
	ScheduleTimezone   string `json:"schedule_timezone"`
}

func (s *Server) getLocalSourceSchedule(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	// The shared middleware intentionally permits non-local Sources, but
	// they must never acquire this dedicated owning-device projection.
	if _, exists := c.Get(localSourceExecutorContextKey); !exists {
		fail(c, http.StatusForbidden, "owning device and authorized local Root required")
		return
	}
	var source meta.Source
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// The device row is locked first, followed by Source and binding.
		// Revoke, Root binding and Source revision changes fail closed.
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
			fail(c, http.StatusConflict, "local Source must remain paused")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "source not found")
		default:
			fail(c, http.StatusInternalServerError, "read local Source schedule failed")
		}
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(source.Revision, 10)))
	c.JSON(http.StatusOK, localSourceScheduleDTO{
		SourceID: source.ID, Revision: source.Revision,
		ScheduleType:       source.ScheduleType,
		ScheduleExpression: source.ScheduleExpression,
		ScheduleTimezone:   source.ScheduleTimezone,
	})
}
