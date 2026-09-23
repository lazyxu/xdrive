package mount

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

func Run(ctx context.Context, cli *client.Client, root string) error {
	return runPlatform(ctx, cli, root)
}
