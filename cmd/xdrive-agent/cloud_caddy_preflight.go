package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

func (c *agentController) CloudAdminCaddyHTTPSPreflight(ctx context.Context) (client.AdminCaddyPreflight, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.AdminCaddyPreflight{}, err
	}
	return cli.AdminCaddyHTTPSPreflight(ctx)
}
