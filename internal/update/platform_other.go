//go:build !linux && !windows

package update

import (
	"context"
	"fmt"
)

func platformAssetName() string { return "" }

func installDownloaded(context.Context, string, Result) (string, error) {
	return "", fmt.Errorf("automatic updates are only supported on Linux and Windows")
}

func LastInstallStatus() (InstallStatus, error) {
	return InstallStatus{}, fmt.Errorf("automatic updates are only supported on Linux and Windows")
}
