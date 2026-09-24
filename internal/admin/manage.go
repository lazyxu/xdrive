package admin

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrUserNotFound    = errors.New("xDrive user not found")
	ErrLastActiveAdmin = errors.New("last active xDrive administrator cannot be disabled")
)

type UserSummary struct {
	ID                 uint64
	Username           string
	Role               string
	Disabled           bool
	MustChangePassword bool
	QuotaBytes         int64
	LastLoginAt        *time.Time
}

func ListUsers(db *gorm.DB) ([]UserSummary, error) {
	var users []meta.User
	if err := db.Order("username ASC").Find(&users).Error; err != nil {
		return nil, err
	}
	out := make([]UserSummary, 0, len(users))
	for _, user := range users {
		out = append(out, UserSummary{
			ID:                 user.ID,
			Username:           user.Username,
			Role:               user.Role,
			Disabled:           user.DisabledAt != nil,
			MustChangePassword: user.MustChangePassword,
			QuotaBytes:         user.QuotaBytes,
			LastLoginAt:        user.LastLoginAt,
		})
	}
	return out, nil
}

func ResetPassword(db *gorm.DB, username, password string, mustChange bool) (meta.User, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return meta.User{}, fmt.Errorf("username is required")
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return meta.User{}, err
	}

	var updated meta.User
	err = db.Transaction(func(tx *gorm.DB) error {
		var user meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("username = ?", username).
			First(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrUserNotFound
			}
			return err
		}

		now := time.Now()
		if err := tx.Model(&meta.RefreshToken{}).
			Where("user_id = ? AND revoked_at IS NULL", user.ID).
			Update("revoked_at", now).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.User{}).Where("id = ?", user.ID).Updates(map[string]any{
			"password_hash":        hash,
			"must_change_password": mustChange,
			"session_version":      gorm.Expr("session_version + 1"),
		}).Error; err != nil {
			return err
		}
		return tx.First(&updated, user.ID).Error
	})
	return updated, err
}

func SetDisabled(db *gorm.DB, username string, disabled bool) (meta.User, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return meta.User{}, fmt.Errorf("username is required")
	}

	var updated meta.User
	err := db.Transaction(func(tx *gorm.DB) error {
		var user meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("username = ?", username).
			First(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrUserNotFound
			}
			return err
		}

		currentlyDisabled := user.DisabledAt != nil
		if currentlyDisabled == disabled {
			updated = user
			return nil
		}

		if disabled && user.Role == meta.UserRoleAdmin {
			var count int64
			if err := tx.Model(&meta.User{}).
				Where("role = ? AND disabled_at IS NULL AND id <> ?", meta.UserRoleAdmin, user.ID).
				Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				return ErrLastActiveAdmin
			}
		}

		updates := map[string]any{}
		if disabled {
			now := time.Now()
			updates["disabled_at"] = &now
			updates["session_version"] = gorm.Expr("session_version + 1")
			if err := tx.Model(&meta.RefreshToken{}).
				Where("user_id = ? AND revoked_at IS NULL", user.ID).
				Update("revoked_at", now).Error; err != nil {
				return err
			}
		} else {
			updates["disabled_at"] = nil
		}
		if err := tx.Model(&meta.User{}).Where("id = ?", user.ID).Updates(updates).Error; err != nil {
			return err
		}
		return tx.First(&updated, user.ID).Error
	})
	return updated, err
}
