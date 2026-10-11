package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

func (c *agentController) CloudVerifyAdminCaddyAliDNSRead(ctx context.Context, input client.AdminCaddyAliDNSReadVerifyInput) (client.AdminCaddyAliDNSReadVerify, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.AdminCaddyAliDNSReadVerify{}, err
	}
	return cli.VerifyAdminCaddyAliDNSRead(ctx, input)
}
