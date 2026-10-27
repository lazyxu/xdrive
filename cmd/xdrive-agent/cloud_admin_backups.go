package main

import (
	"context"
	"encoding/json"

	"github.com/lazyxu/xdrive/internal/client"
)

func (c *agentController) CloudAdminServerBackups(ctx context.Context) (json.RawMessage, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.AdminServerBackups(ctx)
}

func (c *agentController) CloudAdminServerBackupAction(ctx context.Context, input client.AdminServerBackupRequest) (json.RawMessage, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.AdminServerBackupAction(ctx, input)
}
