//go:build !linux && !windows

package mount

import (
	"context"
	"fmt"

	"github.com/lazyxu/xdrive/internal/client"
)

func runPlatform(ctx context.Context, cli *client.Client, root string) error {
	return runPlatformWithOptions(ctx, cli, root, Options{})
}

func runPlatformWithOptions(context.Context, *client.Client, string, Options) error {
	return fmt.Errorf("xDrive mount is currently supported on Linux and Windows")
}
