package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// Original Agent owns the authenticated Server account. A NAS CGI may ask
// only for one validated immutable slice; never forward a caller-supplied URL,
// local destination path, ticket, credential or arbitrary HTTP headers.
func (c *agentController) CloudOwnerMediaRange(
	ctx context.Context, nodeID, revision uint64, offset int64, length int,
) (client.OwnerMediaRange, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.OwnerMediaRange{}, err
	}
	return cli.DownloadVerifiedRange(ctx, nodeID, revision, offset, length)
}
