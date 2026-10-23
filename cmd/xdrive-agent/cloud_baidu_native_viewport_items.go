package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// Desktop Agent's authenticated Server client owns the direct transport.
// It cannot convert coordinates, bypass Consent, or synthesize Gallery items.
func (c *agentController) CloudBaiduNativeViewportItems(
	ctx context.Context, bounds client.BaiduNativeViewportBounds,
	limit, offset int, filter client.BaiduNativeViewportItemsFilter,
) (client.MediaItemRange, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaItemRange{}, err
	}
	return cli.BaiduNativeViewportItems(ctx, bounds, limit, offset, filter)
}
