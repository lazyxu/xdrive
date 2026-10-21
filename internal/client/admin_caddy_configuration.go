package client

import (
	"context"
	"net/http"
)

// Caddy configuration saves only PostgreSQL desired state. Neither this
// transport nor a successful response authorizes Host/Caddy deployment.
type AdminCaddyConfigurationHTTPS struct {
	Enabled    bool   `json:"enabled"`
	Domain     string `json:"domain"`
	LANEnabled bool   `json:"lan_enabled"`
	LANIP      string `json:"lan_ip"`
}

type AdminCaddyConfigurationAliDNS struct {
	Action          string `json:"action"`
	AccessKeyID     string `json:"access_key_id,omitempty"`
	AccessKeySecret string `json:"access_key_secret,omitempty"`
}

type AdminCaddyConfigurationSaveInput struct {
	HTTPSRevision  uint64                         `json:"https_revision"`
	AliDNSRevision uint64                         `json:"alidns_revision"`
	HTTPS          *AdminCaddyConfigurationHTTPS  `json:"https,omitempty"`
	AliDNS         *AdminCaddyConfigurationAliDNS `json:"alidns,omitempty"`
}

type AdminCaddyConfigurationSaveResult struct {
	HTTPSRevision  uint64 `json:"https_revision"`
	AliDNSRevision uint64 `json:"alidns_revision"`
	Saved          bool   `json:"saved"`
	HostApplied    bool   `json:"host_applied"`
	ApplySupported bool   `json:"apply_supported"`
}

func (c *Client) SaveAdminCaddyConfiguration(ctx context.Context, input AdminCaddyConfigurationSaveInput) (AdminCaddyConfigurationSaveResult, error) {
	var result AdminCaddyConfigurationSaveResult
	err := c.json(ctx, http.MethodPut, "/api/v1/admin/services/caddy/config", input, &result)
	return result, err
}
