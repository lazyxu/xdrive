package api

import (
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type auditEventDTO struct {
	ID            uint64         `json:"id"`
	ActorUserID   *uint64        `json:"actor_user_id,omitempty"`
	ActorUsername string         `json:"actor_username,omitempty"`
	ActorRole     string         `json:"actor_role,omitempty"`
	Action        string         `json:"action"`
	TargetType    string         `json:"target_type,omitempty"`
	TargetID      string         `json:"target_id,omitempty"`
	TargetLabel   string         `json:"target_label,omitempty"`
	Result        string         `json:"result"`
	RequestID     string         `json:"request_id,omitempty"`
	IPAddress     string         `json:"ip_address,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
	CreatedAt     time.Time      `json:"created_at"`
}

type auditEventRangeDTO struct {
	Items         []auditEventDTO `json:"items"`
	TotalCount    int64           `json:"total_count"`
	Offset        int             `json:"offset"`
	Limit         int             `json:"limit"`
	SnapshotMaxID uint64          `json:"snapshot_max_id"`
}

type auditEventFilters struct {
	Action string
	Result string
	Actor  string
}

func auditEventFromContext(c *gin.Context, action, targetType, targetID, targetLabel, result string, metadata map[string]any) auditpkg.Event {
	event := auditpkg.Event{
		Action: action, TargetType: targetType, TargetID: targetID, TargetLabel: targetLabel,
		Result: result, RequestID: strings.TrimSpace(c.GetHeader("X-Request-ID")),
		IPAddress: clientIPAddress(c), Metadata: metadata,
	}
	if user, ok := currentUser(c); ok {
		uid := user.ID
		event.ActorUserID = &uid
		event.ActorUsername = user.Username
		event.ActorRole = user.Role
	}
	return event
}

func auditUserEvent(c *gin.Context, actor meta.User, action string, target meta.User, result string, metadata map[string]any) auditpkg.Event {
	uid := actor.ID
	return auditpkg.Event{
		ActorUserID: &uid, ActorUsername: actor.Username, ActorRole: actor.Role,
		Action: action, TargetType: "user", TargetID: strconv.FormatUint(target.ID, 10),
		TargetLabel: target.Username, Result: result,
		RequestID: strings.TrimSpace(c.GetHeader("X-Request-ID")),
		IPAddress: clientIPAddress(c), Metadata: metadata,
	}
}

func clientIPAddress(c *gin.Context) string {
	value := strings.TrimSpace(c.ClientIP())
	if host, _, err := net.SplitHostPort(value); err == nil {
		return host
	}
	return value
}

func (s *Server) recordAuditBestEffort(c *gin.Context, event auditpkg.Event) {
	_ = auditpkg.Record(s.DB.WithContext(c.Request.Context()), event)
}

func auditEventRangeRequested(c *gin.Context) (bool, bool) {
	raw, exists := c.GetQuery("range")
	if !exists {
		return false, true
	}
	value, err := strconv.ParseBool(strings.TrimSpace(raw))
	if err != nil {
		fail(c, http.StatusBadRequest, "range must be true or false")
		return false, false
	}
	return value, true
}

func auditEventListWindow(c *gin.Context) (int, int, bool) {
	limit := 100
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			fail(c, http.StatusBadRequest, "limit must be 1-200")
			return 0, 0, false
		}
		limit = parsed
	}
	offset := 0
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			fail(c, http.StatusBadRequest, "offset must be zero or greater")
			return 0, 0, false
		}
		offset = parsed
	}
	return limit, offset, true
}

func auditEventFiltersFromRequest(c *gin.Context) (auditEventFilters, bool) {
	filters := auditEventFilters{
		Action: strings.TrimSpace(c.Query("action")),
		Result: strings.TrimSpace(c.Query("result")),
		Actor:  strings.TrimSpace(c.Query("actor")),
	}
	if len(filters.Action) > 80 {
		fail(c, http.StatusBadRequest, "invalid action")
		return auditEventFilters{}, false
	}
	if filters.Result != "" &&
		filters.Result != auditpkg.ResultSuccess &&
		filters.Result != auditpkg.ResultFailure {
		fail(c, http.StatusBadRequest, "invalid result")
		return auditEventFilters{}, false
	}
	if len(filters.Actor) > 64 {
		fail(c, http.StatusBadRequest, "invalid actor")
		return auditEventFilters{}, false
	}
	return filters, true
}

func applyAuditEventFilters(query *gorm.DB, filters auditEventFilters) *gorm.DB {
	if filters.Action != "" {
		query = query.Where("action = ?", filters.Action)
	}
	if filters.Result != "" {
		query = query.Where("result = ?", filters.Result)
	}
	if filters.Actor != "" {
		query = query.Where("lower(actor_username) = lower(?)", filters.Actor)
	}
	return query
}

func auditEventDTOs(events []meta.AuditEvent) []auditEventDTO {
	out := make([]auditEventDTO, 0, len(events))
	for _, event := range events {
		dto := auditEventDTO{
			ID: event.ID, ActorUserID: event.ActorUserID, ActorUsername: event.ActorUsername,
			ActorRole: event.ActorRole, Action: event.Action, TargetType: event.TargetType,
			TargetID: event.TargetID, TargetLabel: event.TargetLabel, Result: event.Result,
			RequestID: event.RequestID, IPAddress: event.IPAddress, CreatedAt: event.CreatedAt,
		}
		if event.Metadata != "" {
			var metadata map[string]any
			if json.Unmarshal([]byte(event.Metadata), &metadata) == nil {
				dto.Metadata = metadata
			}
		}
		out = append(out, dto)
	}
	return out
}

func (s *Server) adminAuditEvents(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	limit, offset, ok := auditEventListWindow(c)
	if !ok {
		return
	}
	rangeRequested, ok := auditEventRangeRequested(c)
	if !ok {
		return
	}
	filters, ok := auditEventFiltersFromRequest(c)
	if !ok {
		return
	}

	query := applyAuditEventFilters(s.DB.Model(&meta.AuditEvent{}), filters)
	if rangeRequested {
		if strings.TrimSpace(c.Query("before_id")) != "" {
			fail(c, http.StatusBadRequest, "before_id is not supported with range=true")
			return
		}

		var snapshotMaxID uint64
		if raw := strings.TrimSpace(c.Query("snapshot_max_id")); raw != "" {
			value, err := strconv.ParseUint(raw, 10, 64)
			if err != nil {
				fail(c, http.StatusBadRequest, "invalid snapshot_max_id")
				return
			}
			snapshotMaxID = value
		} else {
			var snapshot struct {
				MaxID uint64 `gorm:"column:max_id"`
			}
			if err := query.
				Session(&gorm.Session{}).
				Select("COALESCE(MAX(id), 0) AS max_id").
				Scan(&snapshot).Error; err != nil {
				fail(c, http.StatusInternalServerError, "snapshot audit events failed")
				return
			}
			snapshotMaxID = snapshot.MaxID
		}

		bounded := query.Session(&gorm.Session{})
		if snapshotMaxID == 0 {
			bounded = bounded.Where("1 = 0")
		} else {
			bounded = bounded.Where("id <= ?", snapshotMaxID)
		}
		var totalCount int64
		if err := bounded.Session(&gorm.Session{}).Count(&totalCount).Error; err != nil {
			fail(c, http.StatusInternalServerError, "count audit events failed")
			return
		}

		var events []meta.AuditEvent
		if err := bounded.
			Session(&gorm.Session{}).
			Order("id DESC").
			Offset(offset).
			Limit(limit).
			Find(&events).Error; err != nil {
			fail(c, http.StatusInternalServerError, "list audit events failed")
			return
		}
		c.JSON(http.StatusOK, auditEventRangeDTO{
			Items:         auditEventDTOs(events),
			TotalCount:    totalCount,
			Offset:        offset,
			Limit:         limit,
			SnapshotMaxID: snapshotMaxID,
		})
		return
	}

	if raw := strings.TrimSpace(c.Query("before_id")); raw != "" {
		before, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || before == 0 {
			fail(c, http.StatusBadRequest, "invalid before_id")
			return
		}
		query = query.Where("id < ?", before)
	}

	var events []meta.AuditEvent
	if err := query.Order("id DESC").Limit(limit).Find(&events).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list audit events failed")
		return
	}
	c.JSON(http.StatusOK, auditEventDTOs(events))
}

func recordAuditTx(tx *gorm.DB, event auditpkg.Event) error {
	return auditpkg.Record(tx, event)
}
