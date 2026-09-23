//go:build !linux && !windows

package update

import (
	"context"
	"fmt"
)

func platformAssetName() string { return "" }

func installDownloaded(context.Context, string) error {
	return fmt.Errorf("automatic updates are only supported on Linux and Windows")
}
