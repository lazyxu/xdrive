package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// Use the current authenticated Server session; do not accept an arbitrary
// host plan URL or attempt to forward a Caddy deployment command.
func (c *agentController) CloudAdminCaddyHTTPSHostPlan(ctx context.Context) (client.AdminCaddyHostPlan, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.AdminCaddyHostPlan{}, err
	}
	return cli.AdminCaddyHTTPSHostPlan(ctx)
}
