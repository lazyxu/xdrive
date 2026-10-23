package client

import (
	"context"
	"net/http"
	"net/url"
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
	HostEnvSHA256  string                         `json:"host_env_sha256,omitempty"`
	HTTPSRevision  uint64                         `json:"https_revision"`
	AliDNSRevision uint64                         `json:"alidns_revision"`
	HTTPS          *AdminCaddyConfigurationHTTPS  `json:"https,omitempty"`
	AliDNS         *AdminCaddyConfigurationAliDNS `json:"alidns,omitempty"`
}

type AdminCaddyConfigurationSaveResult struct {
	HostEnvSHA256  string `json:"host_env_sha256,omitempty"`
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

type AdminCaddyDeployState struct {
	Protocol   string `json:"protocol"`
	RequestID  string `json:"request_id"`
	State      string `json:"state"`
	SHA256     string `json:"sha256"`
	RolledBack bool   `json:"rolled_back,omitempty"`
}

func (c *Client) StartAdminCaddyDeploy(ctx context.Context) (AdminCaddyDeployState, error) {
	var result AdminCaddyDeployState
	err := c.json(ctx, http.MethodPost, "/api/v1/admin/services/caddy/config/deploy", struct{}{}, &result)
	return result, err
}
func (c *Client) AdminCaddyDeployStatus(ctx context.Context, id string) (AdminCaddyDeployState, error) {
	var result AdminCaddyDeployState
	err := c.json(ctx, http.MethodGet, "/api/v1/admin/services/caddy/config/deploy?request_id="+url.QueryEscape(id), nil, &result)
	return result, err
}
