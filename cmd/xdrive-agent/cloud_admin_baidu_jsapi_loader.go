package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// Never accepts an AK, destination URL or GPS from Desktop IPC. Use the
// currently authenticated Agent client; Server independently authorizes
// administrator role, current Browser AK revision, audit and cooldown.
func (c *agentController) CloudVerifyAdminBaiduJSAPI4Loader(
	ctx context.Context, revision uint64,
) (client.AdminBaiduJSAPI4LoaderProbe, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.AdminBaiduJSAPI4LoaderProbe{}, err
	}
	return cli.VerifyAdminBaiduJSAPI4Loader(ctx, revision)
}
