package client

import (
	"context"
	"net/http"
	"time"
)

// Caddy AliDNS credentials are encrypted administrator staging, not host state.
type AdminCaddyAliDNSConfig struct {
	Configured     bool       `json:"configured"`
	Revision       uint64     `json:"revision"`
	Source         string     `json:"source"`
	UpdatedAt      *time.Time `json:"updated_at,omitempty"`
	Editable       bool       `json:"editable"`
	ApplyState     string     `json:"apply_state"`
	ApplySupported bool       `json:"apply_supported"`
	Requirement    string     `json:"requirement"`

	HostApplyPending bool `json:"host_apply_pending"`
}
type AdminCaddyAliDNSUpdate struct {
	Revision        uint64 `json:"revision"`
	AccessKeyID     string `json:"access_key_id,omitempty"`
	AccessKeySecret string `json:"access_key_secret,omitempty"`
	Clear           bool   `json:"clear,omitempty"`
}
type AdminCaddyAliDNSReveal struct {
	AccessKeyID      string `json:"access_key_id"`
	AccessKeySecret  string `json:"access_key_secret"`
	ExpiresInSeconds int    `json:"expires_in_seconds"`
}

func (c *Client) AdminCaddyAliDNSConfig(ctx context.Context) (AdminCaddyAliDNSConfig, error) {
	var result AdminCaddyAliDNSConfig
	err := c.json(ctx, http.MethodGet, "/api/v1/admin/services/caddy/alidns", nil, &result)
	return result, err
}
func (c *Client) UpdateAdminCaddyAliDNS(ctx context.Context, input AdminCaddyAliDNSUpdate) (AdminCaddyAliDNSConfig, error) {
	var result AdminCaddyAliDNSConfig
	err := c.json(ctx, http.MethodPut, "/api/v1/admin/services/caddy/alidns", input, &result)
	return result, err
}
func (c *Client) RevealAdminCaddyAliDNS(ctx context.Context, revision uint64) (AdminCaddyAliDNSReveal, error) {
	var result AdminCaddyAliDNSReveal
	err := c.json(ctx, http.MethodPost, "/api/v1/admin/services/caddy/alidns/reveal", map[string]uint64{"revision": revision}, &result)
	return result, err
}
