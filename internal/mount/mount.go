package mount

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

func Run(ctx context.Context, cli *client.Client, root string) error {
	return RunWithOptions(ctx, cli, root, Options{})
}

func RunWithOptions(ctx context.Context, cli *client.Client, root string, opts Options) error {
	return runPlatformWithOptions(ctx, cli, root, opts)
}
