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

func (s *Server) adminAuditEvents(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	limit := 100
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			fail(c, http.StatusBadRequest, "limit must be 1-200")
			return
		}
		limit = parsed
	}

	q := s.DB.Model(&meta.AuditEvent{})
	if raw := strings.TrimSpace(c.Query("before_id")); raw != "" {
		before, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || before == 0 {
			fail(c, http.StatusBadRequest, "invalid before_id")
			return
		}
		q = q.Where("id < ?", before)
	}
	if action := strings.TrimSpace(c.Query("action")); action != "" {
		if len(action) > 80 {
			fail(c, http.StatusBadRequest, "invalid action")
			return
		}
		q = q.Where("action = ?", action)
	}
	if result := strings.TrimSpace(c.Query("result")); result != "" {
		if result != auditpkg.ResultSuccess && result != auditpkg.ResultFailure {
			fail(c, http.StatusBadRequest, "invalid result")
			return
		}
		q = q.Where("result = ?", result)
	}
	if actor := strings.TrimSpace(c.Query("actor")); actor != "" {
		if len(actor) > 64 {
			fail(c, http.StatusBadRequest, "invalid actor")
			return
		}
		q = q.Where("lower(actor_username) = lower(?)", actor)
	}

	var events []meta.AuditEvent
	if err := q.Order("id DESC").Limit(limit).Find(&events).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list audit events failed")
		return
	}
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
	c.JSON(http.StatusOK, out)
}

func recordAuditTx(tx *gorm.DB, event auditpkg.Event) error {
	return auditpkg.Record(tx, event)
}
