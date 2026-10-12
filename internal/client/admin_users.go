package client

import (
	"context"
	"fmt"
	"net/http"
)

type AdminUser struct {
	ID                 uint64  `json:"id"`
	Username           string  `json:"username"`
	Role               string  `json:"role"`
	Disabled           bool    `json:"disabled"`
	MustChangePassword bool    `json:"must_change_password"`
	QuotaBytes         int64   `json:"quota_bytes"`
	PhysicalUsedBytes  int64   `json:"physical_used_bytes"`
	ReservedBytes      int64   `json:"reserved_bytes"`
	AvailableBytes     int64   `json:"available_bytes"`
	LogicalFileBytes   int64   `json:"logical_file_bytes"`
	TrashBytes         int64   `json:"trash_bytes"`
	HistoryBytes       int64   `json:"history_bytes"`
	OverQuota          bool    `json:"over_quota"`
	LastLoginAt        *string `json:"last_login_at,omitempty"`
	CreatedAt          string  `json:"created_at"`
	UpdatedAt          string  `json:"updated_at"`
}

type AdminCreateUserInput struct {
	Username           string `json:"username"`
	Password           string `json:"password"`
	Role               string `json:"role"`
	MustChangePassword bool   `json:"must_change_password"`
	QuotaBytes         int64  `json:"quota_bytes"`
}

type AdminUpdateUserInput struct {
	Role       *string `json:"role,omitempty"`
	Disabled   *bool   `json:"disabled,omitempty"`
	QuotaBytes *int64  `json:"quota_bytes,omitempty"`
}

func (c *Client) AdminUsers(ctx context.Context) ([]AdminUser, error) {
	var result []AdminUser
	err := c.json(ctx, http.MethodGet, "/api/v1/admin/users", nil, &result)
	return result, err
}

func (c *Client) AdminCreateUser(ctx context.Context, input AdminCreateUserInput) (AdminUser, error) {
	var result AdminUser
	err := c.json(ctx, http.MethodPost, "/api/v1/admin/users", input, &result)
	return result, err
}

func (c *Client) AdminUpdateUser(ctx context.Context, id uint64, input AdminUpdateUserInput) (AdminUser, error) {
	var result AdminUser
	err := c.json(ctx, http.MethodPatch, fmt.Sprintf("/api/v1/admin/users/%d", id), input, &result)
	return result, err
}

func (c *Client) AdminResetUserPassword(ctx context.Context, id uint64, password string, mustChange bool) error {
	return c.json(ctx, http.MethodPost, fmt.Sprintf("/api/v1/admin/users/%d/reset-password", id),
		map[string]any{"password": password, "must_change_password": mustChange}, nil)
}

func (c *Client) AdminRevokeUserSessions(ctx context.Context, id uint64) error {
	return c.json(ctx, http.MethodPost, fmt.Sprintf("/api/v1/admin/users/%d/revoke-sessions", id), nil, nil)
}

func (c *Client) AdminDeleteUser(ctx context.Context, id uint64) error {
	return c.json(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/admin/users/%d", id), nil, nil)
}
