package main

import (
	"context"
	"errors"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// CloudIssueDesktopMapGuestGrant never exports native Access/Refresh tokens.
// Only the authenticated local Desktop IPC may request a short-lived one-use
// ticket. Actual Server grants are tied to the native refresh record.
func (c *agentController) CloudIssueDesktopMapGuestGrant(ctx context.Context) (client.DesktopMapGuestGrant, error) {
	before := c.Snapshot()
	if !before.Configured || before.MustChangePassword ||
		before.AuthStatus != "已登录" || before.Username == "" ||
		!strings.HasPrefix(before.Server, "https://") {
		return client.DesktopMapGuestGrant{}, errors.New("native Desktop login required")
	}
	cfg, err := userconfig.Load()
	if err != nil || cfg.Username != before.Username ||
		!sameAgentLoginOrigin(cfg.Server, before.Server) ||
		cfg.MustChangePassword {
		return client.DesktopMapGuestGrant{}, errors.New("native Desktop session mismatch")
	}
	cli, err := userconfig.NewClient(cfg)
	if err != nil {
		return client.DesktopMapGuestGrant{}, err
	}
	grant, err := cli.IssueDesktopMapGuestGrant(ctx)
	if err != nil {
		return client.DesktopMapGuestGrant{}, err
	}
	after := c.Snapshot()
	if after.Username != before.Username || after.Server != before.Server ||
		!after.Configured || after.MustChangePassword ||
		after.AuthStatus != "已登录" || grant.Username != before.Username {
		return client.DesktopMapGuestGrant{}, errors.New("Desktop Owner changed during map grant")
	}
	return grant, nil
}
