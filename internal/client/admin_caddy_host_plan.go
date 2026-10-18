package client

import (
	"context"
	"net/http"
)

// A canonical nonsecret operator preview. It is not a host apply receipt,
// authenticated rescue approval or an installed Caddy configuration.
type AdminCaddyHostPlan struct {
	Protocol           string `json:"protocol"`
	DesiredRevision    uint64 `json:"desired_revision"`
	CredentialRevision uint64 `json:"credential_revision"`
	DomainEnabled      bool   `json:"domain_enabled"`
	Domain             string `json:"domain"`
	LANEnabled         bool   `json:"lan_enabled"`
	LANIP              string `json:"lan_ip"`
}

func (c *Client) AdminCaddyHTTPSHostPlan(ctx context.Context) (AdminCaddyHostPlan, error) {
	var out AdminCaddyHostPlan
	err := c.json(ctx, http.MethodGet, "/api/v1/admin/services/caddy/https/host-plan", nil, &out)
	return out, err
}
