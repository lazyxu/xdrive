package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// Current authenticated Owner only, no arbitrary URLs or Browser AK.
func (c *agentController) CloudMediaBaiduMapCoverage(ctx context.Context) (client.MediaBaiduMapCoverage, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaBaiduMapCoverage{}, err
	}
	return cli.MediaBaiduMapCoverage(ctx)
}

// Read-only authenticated Owner query; no raw GPS, id or provider request.
func (c *agentController) CloudMediaBaiduMapCoverageReasons(ctx context.Context) (client.MediaBaiduMapCoverageReasons, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaBaiduMapCoverageReasons{}, err
	}
	return cli.MediaBaiduMapCoverageReasons(ctx)
}
