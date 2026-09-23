package admin

import (
	"errors"
	"fmt"
	"strings"

	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

var ErrAdminExists = errors.New("an administrator already exists")

func Bootstrap(db *gorm.DB, username, password string) (meta.User, error) {
	var user meta.User
	username = strings.TrimSpace(username)
	if len(username) < 3 || len(username) > 64 {
		return user, fmt.Errorf("username must be 3-64 characters")
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return user, err
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&meta.User{}).Where("role = ?", meta.UserRoleAdmin).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return ErrAdminExists
		}
		user = meta.User{
			Username:           username,
			PasswordHash:       hash,
			Role:               meta.UserRoleAdmin,
			MustChangePassword: false,
			SessionVersion:     1,
		}
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		return tx.Create(&meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}).Error
	})
	return user, err
}
