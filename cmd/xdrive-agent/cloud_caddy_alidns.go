package main

import (
	"context"
	"github.com/lazyxu/xdrive/internal/client"
)

func (c *agentController) CloudAdminCaddyAliDNSConfig(ctx context.Context) (client.AdminCaddyAliDNSConfig, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.AdminCaddyAliDNSConfig{}, err
	}
	return cli.AdminCaddyAliDNSConfig(ctx)
}
func (c *agentController) CloudSetAdminCaddyAliDNS(ctx context.Context, input client.AdminCaddyAliDNSUpdate) (client.AdminCaddyAliDNSConfig, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.AdminCaddyAliDNSConfig{}, err
	}
	return cli.UpdateAdminCaddyAliDNS(ctx, input)
}
func (c *agentController) CloudRevealAdminCaddyAliDNS(ctx context.Context, revision uint64) (client.AdminCaddyAliDNSReveal, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.AdminCaddyAliDNSReveal{}, err
	}
	return cli.RevealAdminCaddyAliDNS(ctx, revision)
}
