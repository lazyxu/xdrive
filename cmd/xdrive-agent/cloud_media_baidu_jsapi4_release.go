package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// Authenticated active-Owner Server release; no Browser AK, raw
// GPS, media identities, caller-supplied URL, or renderer-originated token.
func (c *agentController) CloudMediaBaiduJSAPI4Release(ctx context.Context) (client.MediaBaiduJSAPI4Release, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.MediaBaiduJSAPI4Release{}, err
	}
	return cli.MediaBaiduJSAPI4Release(ctx)
}
