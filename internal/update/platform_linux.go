//go:build linux

package update

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func platformAssetName() string { return "xdrive-client-linux-amd64.deb" }

func installDownloaded(ctx context.Context, path string, result Result) (string, error) {
	if os.Geteuid() != 0 {
		return "", fmt.Errorf("installing the Linux update requires root; the packaged xdrive-update.timer performs this automatically")
	}
	cmd := exec.CommandContext(ctx, "apt-get", "install", "-y", "--allow-downgrades", path)
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("apt-get install update: %w", err)
	}
	for _, required := range []string{"/usr/bin/xd", "/usr/bin/xdrive-agent", "/usr/bin/xdrive-desktop"} {
		if info, err := os.Stat(required); err != nil || info.IsDir() {
			return "", fmt.Errorf("post-install health check failed: %s is missing", required)
		}
	}
	versionCmd := exec.CommandContext(ctx, filepath.Clean("/usr/bin/xd"), "version")
	output, err := versionCmd.Output()
	if err != nil {
		return "", fmt.Errorf("post-install health check failed: xd version: %w", err)
	}
	if got := strings.TrimSpace(string(output)); got != strings.TrimSpace(result.Latest) {
		return "", fmt.Errorf("post-install health check failed: xd version=%q want=%q", got, result.Latest)
	}
	return "unified client package installed and post-install health check passed", nil
}

func LastInstallStatus() (InstallStatus, error) {
	return InstallStatus{
		State:   "synchronous",
		Message: "Linux client updates are installed synchronously by apt/dpkg; there is no detached transaction.",
	}, nil
}
