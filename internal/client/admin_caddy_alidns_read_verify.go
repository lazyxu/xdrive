package client

import (
	"context"
	"net/http"
	"time"
)

// Explicitly auditable AliDNS read-only operation: never DNS write or Caddy apply.
type AdminCaddyAliDNSReadVerifyInput struct {
	DesiredRevision    uint64 `json:"desired_revision"`
	CredentialRevision uint64 `json:"credential_revision"`
}
type AdminCaddyAliDNSReadVerify struct {
	State                   string    `json:"state"`
	DesiredRevision         uint64    `json:"desired_revision"`
	CredentialRevision      uint64    `json:"credential_revision"`
	CheckedAt               time.Time `json:"checked_at"`
	ReadPermissionVerified  bool      `json:"read_permission_verified"`
	WritePermissionVerified bool      `json:"write_permission_verified"`
	ApplySupported          bool      `json:"apply_supported"`
	PublicHTTPSVerified     bool      `json:"public_https_verified"`
	Detail                  string    `json:"detail"`
}

func (c *Client) VerifyAdminCaddyAliDNSRead(ctx context.Context, input AdminCaddyAliDNSReadVerifyInput) (AdminCaddyAliDNSReadVerify, error) {
	var out AdminCaddyAliDNSReadVerify
	err := c.json(ctx, http.MethodPost, "/api/v1/admin/services/caddy/alidns/verify-read", input, &out)
	return out, err
}
