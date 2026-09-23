//go:build linux

package update

import (
	"context"
	"fmt"
	"os"
	"os/exec"
)

func platformAssetName() string { return "xdrive-client-linux-amd64.deb" }

func installDownloaded(ctx context.Context, path string) error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("installing the Linux update requires root; the packaged xdrive-update.timer performs this automatically")
	}
	cmd := exec.CommandContext(ctx, "apt-get", "install", "-y", "--allow-downgrades", path)
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("apt-get install update: %w", err)
	}
	return nil
}
