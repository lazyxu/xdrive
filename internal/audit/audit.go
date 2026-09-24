package audit

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	ResultSuccess = "success"
	ResultFailure = "failure"

	ActionLoginSuccess       = "auth.login.success"
	ActionLoginFailure       = "auth.login.failure"
	ActionPasswordChange     = "auth.password.change"
	ActionAdminUserCreate    = "admin.user.create"
	ActionAdminRoleChange    = "admin.user.role_change"
	ActionAdminUserDisable   = "admin.user.disable"
	ActionAdminUserEnable    = "admin.user.enable"
	ActionAdminQuotaChange   = "admin.user.quota_change"
	ActionAdminPasswordReset = "admin.user.password_reset"
	ActionAdminSessionRevoke = "admin.user.sessions_revoke"
	ActionAdminUserDelete    = "admin.user.delete"
	ActionPermanentDelete    = "file.permanent_delete"
	ActionVersionRestore     = "file.version_restore"
	ActionBackup             = "system.backup"
	ActionRestore            = "system.restore"
	ActionUpdate             = "system.update"
)

type Event struct {
	ActorUserID   *uint64
	ActorUsername string
	ActorRole     string
	Action        string
	TargetType    string
	TargetID      string
	TargetLabel   string
	Result        string
	RequestID     string
	IPAddress     string
	Metadata      map[string]any
}

func Record(db *gorm.DB, event Event) error {
	if db == nil {
		return fmt.Errorf("audit database is nil")
	}
	event.Action = limit(strings.TrimSpace(event.Action), 80)
	event.TargetType = limit(strings.TrimSpace(event.TargetType), 32)
	event.TargetID = limit(strings.TrimSpace(event.TargetID), 128)
	event.TargetLabel = limit(strings.TrimSpace(event.TargetLabel), 255)
	event.ActorUsername = limit(strings.TrimSpace(event.ActorUsername), 64)
	event.ActorRole = limit(strings.TrimSpace(event.ActorRole), 16)
	event.RequestID = limit(strings.TrimSpace(event.RequestID), 64)
	event.IPAddress = limit(strings.TrimSpace(event.IPAddress), 64)
	if event.Action == "" {
		return fmt.Errorf("audit action is required")
	}
	if event.Result != ResultSuccess && event.Result != ResultFailure {
		return fmt.Errorf("invalid audit result %q", event.Result)
	}
	metadata := ""
	if len(event.Metadata) != 0 {
		raw, err := json.Marshal(event.Metadata)
		if err != nil {
			return fmt.Errorf("marshal audit metadata: %w", err)
		}
		if len(raw) > 4096 {
			return fmt.Errorf("audit metadata exceeds 4096 bytes")
		}
		metadata = string(raw)
	}
	record := meta.AuditEvent{
		ActorUserID:   event.ActorUserID,
		ActorUsername: event.ActorUsername,
		ActorRole:     event.ActorRole,
		Action:        event.Action,
		TargetType:    event.TargetType,
		TargetID:      event.TargetID,
		TargetLabel:   event.TargetLabel,
		Result:        event.Result,
		RequestID:     event.RequestID,
		IPAddress:     event.IPAddress,
		Metadata:      metadata,
		CreatedAt:     time.Now().UTC(),
	}
	return db.Create(&record).Error
}

func limit(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}
