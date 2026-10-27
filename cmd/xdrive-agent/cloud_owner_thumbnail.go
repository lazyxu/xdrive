package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// Unlike generic cached Desktop thumbnails, this DSM Owner read requires a
// real Server revision comparison on every call. A stale Owner/revision cannot
// inherit the original Agent's derivative cache or privileged write access.
func (c *agentController) CloudOwnerThumbnail(
	ctx context.Context, id, revision uint64,
) (client.OwnerThumbnail, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.OwnerThumbnail{}, err
	}
	return cli.MediaOwnerThumbnail(ctx, id, revision)
}
