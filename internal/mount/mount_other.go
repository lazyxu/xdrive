//go:build !linux && !windows

package mount

import (
	"context"
	"fmt"

	"github.com/lazyxu/xdrive/internal/client"
)

func runPlatform(context.Context, *client.Client, string) error {
	return fmt.Errorf("xDrive mount is currently supported on Linux and Windows")
}
