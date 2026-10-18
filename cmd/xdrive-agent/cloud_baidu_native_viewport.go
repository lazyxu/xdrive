package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// One Agent client port for Desktop only; the same authenticated Server
// endpoint powers Web and Mobile Web. No local conversion or cached GPS.
func (c *agentController) CloudBaiduNativeViewport(ctx context.Context,
	bounds client.BaiduNativeViewportBounds, limit, offset int,
) (client.BaiduNativeViewportPage, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.BaiduNativeViewportPage{}, err
	}
	return cli.BaiduNativeViewport(ctx, bounds, limit, offset)
}
