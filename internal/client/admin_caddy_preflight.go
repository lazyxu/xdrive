package client

import (
	"context"
	"net/http"
	"time"
)

// Bounded local prerequisites for a future Caddy maintenance contract.
// A successful check is not host-apply authorization or external HTTPS proof.
type AdminCaddyPreflightCheck struct {
	ID     string `json:"id"`
	State  string `json:"state"`
	Detail string `json:"detail"`
}

type AdminCaddyPreflight struct {
	CheckedAt               time.Time                  `json:"checked_at"`
	Action                  string                     `json:"action"`
	DesiredRevision         uint64                     `json:"desired_revision"`
	CredentialRevision      uint64                     `json:"credential_revision"`
	ConfigurationComplete   bool                       `json:"configuration_complete"`
	HostObserved            bool                       `json:"host_observed"`
	HostIngressReady        bool                       `json:"host_ingress_ready"`
	HostLocalTLSVerified    bool                       `json:"host_local_tls_verified"`
	DesiredDomainLocalMatch string                     `json:"desired_domain_local_match"`
	ApplySupported          bool                       `json:"apply_supported"`
	Checks                  []AdminCaddyPreflightCheck `json:"checks"`
}

func (c *Client) AdminCaddyHTTPSPreflight(ctx context.Context) (AdminCaddyPreflight, error) {
	var result AdminCaddyPreflight
	err := c.json(ctx, http.MethodGet, "/api/v1/admin/services/caddy/https/preflight", nil, &result)
	return result, err
}
