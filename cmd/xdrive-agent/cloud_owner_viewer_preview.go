package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// The original owning Agent performs the authenticated Server read.
// DSM receives only a bounded derivative slice, never a Server token or URL.
func (c *agentController) CloudOwnerViewerPreviewRange(ctx context.Context,
	id, revision uint64, format string, offset int64, length int,
) (client.OwnerViewerPreviewRange, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.OwnerViewerPreviewRange{}, err
	}
	return cli.MediaOwnerViewerPreviewRange(ctx, id, revision, format, offset, length)
}
