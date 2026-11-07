package main

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// desktopMapLANTrustReceipt contains ONLY the public CA (never Agent access,
// refresh, password or session identity). The Desktop Main uses it in memory
// after separately validating the exact HTTPS IP SAN and current Owner.
type desktopMapLANTrustReceipt struct {
	Available bool   `json:"available"`
	Server    string `json:"server,omitempty"`
	Username  string `json:"username,omitempty"`
	RootPEM   string `json:"root_pem,omitempty"`
}

func (c *agentController) CloudDesktopMapLANTrust(_ context.Context) (desktopMapLANTrustReceipt, error) {
	before := c.Snapshot()
	if !before.Configured || before.MustChangePassword ||
		before.AuthStatus != "已登录" || before.Username == "" ||
		before.Server == "" {
		return desktopMapLANTrustReceipt{}, errors.New("native Desktop login required")
	}
	cfg, err := userconfig.Load()
	if err != nil || cfg.SessionInvalid || cfg.MustChangePassword ||
		cfg.Username != before.Username || !sameAgentLoginOrigin(cfg.Server, before.Server) ||
		cfg.ConnectionIP != before.ConnectionIP {
		return desktopMapLANTrustReceipt{}, errors.New("native Desktop session mismatch")
	}
	if cfg.TrustedLANRootPEM == "" {
		// System-CA or public-domain TLS requires no private CA handoff.
		return desktopMapLANTrustReceipt{Available: false}, nil
	}
	if err := client.ValidPrivateLANRoot(cfg.Server, cfg.TrustedLANRootPEM); err != nil {
		return desktopMapLANTrustReceipt{}, errors.New("invalid native LAN trust")
	}
	after := c.Snapshot()
	if !after.Configured || after.MustChangePassword ||
		after.AuthStatus != "已登录" || after.Username != before.Username ||
		after.Server != before.Server || after.ConnectionIP != before.ConnectionIP {
		return desktopMapLANTrustReceipt{}, errors.New("native Desktop session changed")
	}
	return desktopMapLANTrustReceipt{
		Available: true, Server: before.Server,
		Username: before.Username, RootPEM: cfg.TrustedLANRootPEM,
	}, nil
}
