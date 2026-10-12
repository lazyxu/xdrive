package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

func (c *agentController) CloudAdminAuditRange(ctx context.Context, query client.AdminAuditRangeQuery) (client.AdminAuditRange, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.AdminAuditRange{}, err
	}
	return cli.AdminAuditRange(ctx, query)
}
