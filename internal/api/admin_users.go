package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type userDTO struct {
	ID                 uint64     `json:"id"`
	Username           string     `json:"username"`
	Role               string     `json:"role"`
	Disabled           bool       `json:"disabled"`
	MustChangePassword bool       `json:"must_change_password"`
	QuotaBytes         int64      `json:"quota_bytes"`
	PhysicalUsedBytes  int64      `json:"physical_used_bytes"`
	LogicalFileBytes   int64      `json:"logical_file_bytes"`
	TrashBytes         int64      `json:"trash_bytes"`
	HistoryBytes       int64      `json:"history_bytes"`
	OverQuota          bool       `json:"over_quota"`
	LastLoginAt        *time.Time `json:"last_login_at,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

func toUserDTO(user meta.User) userDTO {
	return userDTO{
		ID:                 user.ID,
		Username:           user.Username,
		Role:               user.Role,
		Disabled:           user.DisabledAt != nil,
		MustChangePassword: user.MustChangePassword,
		QuotaBytes:         user.QuotaBytes,
		LastLoginAt:        user.LastLoginAt,
		CreatedAt:          user.CreatedAt,
		UpdatedAt:          user.UpdatedAt,
	}
}

func userDTOWithQuota(db *gorm.DB, user meta.User) (userDTO, error) {
	usage, err := quotaUsageForUser(db, user)
	if err != nil {
		return userDTO{}, err
	}
	dto := toUserDTO(user)
	dto.PhysicalUsedBytes = usage.PhysicalUsedBytes
	dto.LogicalFileBytes = usage.LogicalFileBytes
	dto.TrashBytes = usage.TrashBytes
	dto.HistoryBytes = usage.HistoryBytes
	dto.OverQuota = usage.OverQuota
	return dto, nil
}

func (s *Server) adminListUsers(c *gin.Context) {
	var users []meta.User
	if err := s.DB.Order("username ASC").Find(&users).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list users failed")
		return
	}
	out := make([]userDTO, 0, len(users))
	for _, user := range users {
		dto, err := userDTOWithQuota(s.DB, user)
		if err != nil {
			fail(c, http.StatusInternalServerError, "load user quota usage failed")
			return
		}
		out = append(out, dto)
	}
	c.JSON(http.StatusOK, out)
}

func (s *Server) adminCreateUser(c *gin.Context) {
	var req struct {
		Username           string `json:"username"`
		Password           string `json:"password"`
		Role               string `json:"role"`
		MustChangePassword *bool  `json:"must_change_password"`
		QuotaBytes         int64  `json:"quota_bytes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if len(req.Username) < 3 || len(req.Username) > 64 {
		fail(c, http.StatusBadRequest, "username must be 3-64 characters")
		return
	}
	if req.QuotaBytes < 0 {
		fail(c, http.StatusBadRequest, "quota_bytes must be zero or greater")
		return
	}
	if req.Role == "" {
		req.Role = meta.UserRoleUser
	}
	if !meta.ValidUserRole(req.Role) {
		fail(c, http.StatusBadRequest, "invalid role")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	mustChange := true
	if req.MustChangePassword != nil {
		mustChange = *req.MustChangePassword
	}
	var user meta.User
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		user = meta.User{
			Username:           req.Username,
			PasswordHash:       hash,
			Role:               req.Role,
			MustChangePassword: mustChange,
			SessionVersion:     1,
			QuotaBytes:         req.QuotaBytes,
		}
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		return tx.Create(&meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}).Error
	})
	if err != nil {
		if isDuplicate(err) {
			fail(c, http.StatusConflict, "username already exists")
		} else {
			fail(c, http.StatusInternalServerError, "create user failed")
		}
		return
	}
	dto, err := userDTOWithQuota(s.DB, user)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load user quota usage failed")
		return
	}
	c.JSON(http.StatusCreated, dto)
}

func (s *Server) adminUpdateUser(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid user id")
		return
	}
	var req struct {
		Role       *string `json:"role"`
		Disabled   *bool   `json:"disabled"`
		QuotaBytes *int64  `json:"quota_bytes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if req.QuotaBytes != nil && *req.QuotaBytes < 0 {
		fail(c, http.StatusBadRequest, "quota_bytes must be zero or greater")
		return
	}

	var updated meta.User
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var target meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&target, id).Error; err != nil {
			return err
		}
		if id == userID(c) {
			if req.Disabled != nil && *req.Disabled {
				return errSelfAdminMutation
			}
			if req.Role != nil && *req.Role != meta.UserRoleAdmin {
				return errSelfAdminMutation
			}
		}
		newRole := target.Role
		if req.Role != nil {
			if !meta.ValidUserRole(*req.Role) {
				return errInvalidRole
			}
			newRole = *req.Role
		}
		newDisabled := target.DisabledAt != nil
		if req.Disabled != nil {
			newDisabled = *req.Disabled
		}
		if target.Role == meta.UserRoleAdmin && target.DisabledAt == nil &&
			(newRole != meta.UserRoleAdmin || newDisabled) {
			ok, err := hasAnotherActiveAdmin(tx, target.ID)
			if err != nil {
				return err
			}
			if !ok {
				return errLastAdmin
			}
		}

		updates := map[string]any{}
		if req.Role != nil {
			updates["role"] = newRole
		}
		if req.QuotaBytes != nil {
			updates["quota_bytes"] = *req.QuotaBytes
		}
		if req.Disabled != nil {
			if *req.Disabled {
				now := time.Now()
				updates["disabled_at"] = &now
				updates["session_version"] = gorm.Expr("session_version + 1")
				if err := revokeUserSessions(tx, target.ID); err != nil {
					return err
				}
			} else {
				updates["disabled_at"] = nil
			}
		}
		if len(updates) != 0 {
			if err := tx.Model(&meta.User{}).Where("id = ?", target.ID).Updates(updates).Error; err != nil {
				return err
			}
		}
		return tx.First(&updated, target.ID).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "user not found")
		case errors.Is(err, errInvalidRole):
			fail(c, http.StatusBadRequest, "invalid role")
		case errors.Is(err, errSelfAdminMutation):
			fail(c, http.StatusBadRequest, "cannot disable or demote your own administrator account")
		case errors.Is(err, errLastAdmin):
			fail(c, http.StatusConflict, "last active administrator cannot be disabled or demoted")
		default:
			fail(c, http.StatusInternalServerError, "update user failed")
		}
		return
	}
	dto, dtoErr := userDTOWithQuota(s.DB, updated)
	if dtoErr != nil {
		fail(c, http.StatusInternalServerError, "load user quota usage failed")
		return
	}
	c.JSON(http.StatusOK, dto)
}

func (s *Server) adminResetPassword(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid user id")
		return
	}
	var req struct {
		Password           string `json:"password"`
		MustChangePassword *bool  `json:"must_change_password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	mustChange := true
	if req.MustChangePassword != nil {
		mustChange = *req.MustChangePassword
	}
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		var target meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&target, id).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.User{}).Where("id = ?", id).Updates(map[string]any{
			"password_hash":        hash,
			"must_change_password": mustChange,
			"session_version":      gorm.Expr("session_version + 1"),
		}).Error; err != nil {
			return err
		}
		return revokeUserSessions(tx, id)
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "user not found")
		} else {
			fail(c, http.StatusInternalServerError, "reset password failed")
		}
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) adminRevokeSessions(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid user id")
		return
	}
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var target meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&target, id).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.User{}).Where("id = ?", id).
			Update("session_version", gorm.Expr("session_version + 1")).Error; err != nil {
			return err
		}
		return revokeUserSessions(tx, id)
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "user not found")
		} else {
			fail(c, http.StatusInternalServerError, "revoke sessions failed")
		}
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) adminDeleteUser(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid user id")
		return
	}
	if id == userID(c) {
		fail(c, http.StatusBadRequest, "cannot delete your own administrator account")
		return
	}

	var files []meta.File
	var versions []meta.FileVersion
	var uploadParts []meta.UploadPart
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var target meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&target, id).Error; err != nil {
			return err
		}
		if target.Role == meta.UserRoleAdmin && target.DisabledAt == nil {
			ok, err := hasAnotherActiveAdmin(tx, target.ID)
			if err != nil {
				return err
			}
			if !ok {
				return errLastAdmin
			}
		}

		var nodeIDs []uint64
		if err := tx.Model(&meta.Node{}).Where("owner_id = ?", id).Pluck("id", &nodeIDs).Error; err != nil {
			return err
		}
		if len(nodeIDs) != 0 {
			if err := tx.Where("node_id IN ?", nodeIDs).Find(&versions).Error; err != nil {
				return err
			}
			if err := tx.Where("node_id IN ?", nodeIDs).Find(&files).Error; err != nil {
				return err
			}
			if err := tx.Where("node_id IN ?", nodeIDs).Delete(&meta.FileVersion{}).Error; err != nil {
				return err
			}
			if err := tx.Where("node_id IN ?", nodeIDs).Delete(&meta.File{}).Error; err != nil {
				return err
			}
			if err := tx.Where("id IN ?", nodeIDs).Delete(&meta.Node{}).Error; err != nil {
				return err
			}
		}
		var uploadSessionIDs []string
		if err := tx.Model(&meta.UploadSession{}).Where("owner_id = ?", id).Pluck("id", &uploadSessionIDs).Error; err != nil {
			return err
		}
		if len(uploadSessionIDs) != 0 {
			if err := tx.Where("session_id IN ?", uploadSessionIDs).Find(&uploadParts).Error; err != nil {
				return err
			}
			if err := tx.Where("session_id IN ?", uploadSessionIDs).Delete(&meta.UploadPart{}).Error; err != nil {
				return err
			}
			if err := tx.Where("id IN ?", uploadSessionIDs).Delete(&meta.UploadSession{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("user_id = ?", id).Delete(&meta.RefreshToken{}).Error; err != nil {
			return err
		}
		return tx.Delete(&meta.User{}, id).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "user not found")
		case errors.Is(err, errLastAdmin):
			fail(c, http.StatusConflict, "last active administrator cannot be deleted")
		default:
			fail(c, http.StatusInternalServerError, "delete user failed")
		}
		return
	}
	for _, file := range files {
		_ = s.Store.Delete(c.Request.Context(), file.StorageKey)
	}
	for _, version := range versions {
		_ = s.Store.Delete(c.Request.Context(), version.StorageKey)
	}
	for _, part := range uploadParts {
		if !part.Reused {
			_ = s.Store.Delete(c.Request.Context(), part.StorageKey)
		}
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) changePassword(c *gin.Context) {
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}

	var session authResponse
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		var user meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, userID(c)).Error; err != nil {
			return err
		}
		if auth.CheckPassword(user.PasswordHash, req.CurrentPassword) != nil {
			return errInvalidCurrentPassword
		}
		if err := tx.Model(&meta.User{}).Where("id = ?", user.ID).Updates(map[string]any{
			"password_hash":        hash,
			"must_change_password": false,
			"session_version":      gorm.Expr("session_version + 1"),
		}).Error; err != nil {
			return err
		}
		if err := revokeUserSessions(tx, user.ID); err != nil {
			return err
		}
		if err := tx.First(&user, user.ID).Error; err != nil {
			return err
		}
		session, err = s.issueSession(tx, user)
		return err
	})
	if err != nil {
		if errors.Is(err, errInvalidCurrentPassword) {
			fail(c, http.StatusUnauthorized, "current password is incorrect")
		} else {
			fail(c, http.StatusInternalServerError, "change password failed")
		}
		return
	}
	c.JSON(http.StatusOK, session)
}

var (
	errInvalidRole            = errors.New("invalid role")
	errSelfAdminMutation      = errors.New("self administrator mutation")
	errLastAdmin              = errors.New("last active administrator")
	errInvalidCurrentPassword = errors.New("invalid current password")
)

func revokeUserSessions(tx *gorm.DB, userID uint64) error {
	now := time.Now()
	return tx.Model(&meta.RefreshToken{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Update("revoked_at", now).Error
}

func hasAnotherActiveAdmin(tx *gorm.DB, userID uint64) (bool, error) {
	var count int64
	err := tx.Model(&meta.User{}).
		Where("role = ? AND disabled_at IS NULL AND id <> ?", meta.UserRoleAdmin, userID).
		Count(&count).Error
	return count > 0, err
}
