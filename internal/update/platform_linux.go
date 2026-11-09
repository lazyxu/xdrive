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

func platformAssetName() string { return "xdrive-linux-amd64.deb" }

// linuxInstallerCommand is separate from the unauthenticated package bytes.
// The installer is called only after InstallPreviouslyVerified checks SHA-256
// and size; native PolicyKit owns authorization for an unprivileged desktop
// session, never a long-lived root token or hidden sudo password.
func linuxInstallerCommand(ctx context.Context, path string, euid int) (*exec.Cmd, error) {
	if !filepath.IsAbs(path) || filepath.Base(path) != platformAssetName() {
		return nil, fmt.Errorf("Linux installer must be the exact verified .deb package")
	}
	apt, err := exec.LookPath("apt-get")
	if err != nil {
		return nil, fmt.Errorf("apt-get is unavailable: %w", err)
	}
	args := []string{"install", "-y", "--allow-downgrades", path}
	if euid == 0 {
		return exec.CommandContext(ctx, apt, args...), nil
	}
	if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
		return nil, fmt.Errorf("an interactive Linux desktop session is required for PolicyKit authorization")
	}
	pkexec, err := exec.LookPath("pkexec")
	if err != nil {
		return nil, fmt.Errorf("PolicyKit pkexec is unavailable: %w", err)
	}
	return exec.CommandContext(ctx, pkexec, append([]string{apt}, args...)...), nil
}

func assertLinuxClientPackage(ctx context.Context, path string) error {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 {
		return fmt.Errorf("Linux update package is not a regular nonempty .deb")
	}
	for field, want := range map[string]string{"Package": "xdrive-client", "Architecture": "amd64"} {
		out, err := exec.CommandContext(ctx, "dpkg-deb", "-f", path, field).Output()
		if err != nil || strings.TrimSpace(string(out)) != want {
			return fmt.Errorf("Linux update package has wrong %s metadata", field)
		}
	}
	return nil
}

func installDownloaded(ctx context.Context, path string, result Result) (string, error) {
	if err := assertLinuxClientPackage(ctx, path); err != nil {
		return "", err
	}
	cmd, err := linuxInstallerCommand(ctx, path, os.Geteuid())
	if err != nil {
		return "", err
	}
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("apt-get install verified update: %w", err)
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
	return "verified Linux unified client package installed with authorized apt and post-install health check passed", nil
}

func LastInstallStatus() (InstallStatus, error) {
	return InstallStatus{
		State:   "synchronous",
		Message: "Linux client updates are installed synchronously after root or explicit PolicyKit authorization; no unattended privilege grant is stored.",
	}, nil
}
