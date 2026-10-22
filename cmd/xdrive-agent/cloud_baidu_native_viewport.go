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

func (c *agentController) CloudBaiduJSAPIPrototype(ctx context.Context) (client.BaiduJSAPIPrototypeConfig, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.BaiduJSAPIPrototypeConfig{}, err
	}
	return cli.MediaBaiduJSAPIPrototype(ctx)
}

// Forward the bounded map summary through the authenticated Agent only.
func (c *agentController) CloudMediaPlacesMapOverview(ctx context.Context, bounds client.MediaPlacesViewportBounds, detail bool) (client.MediaPlacesMapOverview, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaPlacesMapOverview{}, err
	}
	return cli.MediaPlacesMapOverview(ctx, bounds, detail)
}
