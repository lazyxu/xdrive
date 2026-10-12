package main

import (
	"context"
	"encoding/json"

	"github.com/lazyxu/xdrive/internal/client"
)

func (c *agentController) CloudAdminStorage(ctx context.Context, request client.AdminStorageRequest) (json.RawMessage, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.AdminStorage(ctx, request)
}
