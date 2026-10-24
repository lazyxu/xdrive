//go:build linux

package caddyhostidentity

import (
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

type privateLimitedHostSnapshot struct{ data []byte }

func (o *privateLimitedHostSnapshot) Write(p []byte) (int, error) {
	if len(p) > privateHostSnapshotMaxBytes-len(o.data) {
		return 0, errUntrusted
	}
	o.data = append(o.data, p...)
	return len(p), nil
}

func privateHostSnapshotPathSafe(path string, dir bool, private bool) bool {
	st, err := os.Lstat(path)
	if err != nil || st.Mode()&os.ModeSymlink != 0 || st.IsDir() != dir ||
		(dir && !st.IsDir()) || (!dir && !st.Mode().IsRegular()) {
		return false
	}
	info, ok := st.Sys().(*syscall.Stat_t)
	if !ok || info.Uid != uint32(os.Geteuid()) || (!dir && info.Nlink != 1) ||
		st.Mode().Perm()&0002 != 0 || st.Mode().Perm()&0020 != 0 {
		return false
	}
	if private && st.Mode().Perm()&0077 != 0 {
		return false
	}
	return true
}

// The executable and argument list are fixed for the installed Host service:
// python3 runs the existing private Host Control snapshot under its shared
// installer lock, with no browser-supplied paths/args and no Docker privileges.
// It only emits the Host's sanitized current domain/LAN target and SHA; no
// AliDNS IDs/secrets or .env bytes. The Host layout MUST be operator-owned.
func privateRunFixedHostSnapshot(ctx context.Context, hostHome string) ([]byte, error) {
	fail := func() ([]byte, error) { return nil, errUntrusted }
	if ctx == nil || ctx.Err() != nil || hostHome == "" || !filepath.IsAbs(hostHome) ||
		filepath.Clean(hostHome) != hostHome {
		return fail()
	}
	if real, err := filepath.EvalSymlinks(hostHome); err != nil || real != hostHome {
		return fail()
	}
	root := hostHome
	script := filepath.Join(root, "bin", "caddy-env-config.py")
	for _, dir := range []string{root, filepath.Join(root, "bin"), filepath.Join(root, "config"), filepath.Join(root, "state")} {
		if !privateHostSnapshotPathSafe(dir, true, false) {
			return fail()
		}
	}
	if !privateHostSnapshotPathSafe(filepath.Join(root, "state", "caddy-env"), true, true) ||
		!privateHostSnapshotPathSafe(script, false, true) ||
		!privateHostSnapshotPathSafe(filepath.Join(root, "config", ".env"), false, true) ||
		!privateHostSnapshotPathSafe(filepath.Join(root, "state", "install.lock"), false, false) {
		// Strict presence prevents the Python snapshot's legacy mkdir/open
		// setup steps from creating journal or lock objects during observation.
		return fail()
	}
	bounded, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(bounded, "/usr/bin/python3", script, "snapshot")
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LC_ALL=C", "HOME=/nonexistent", "XD_CONFIG_DIR=" + root}
	cmd.Stdin = nil
	cmd.Stderr = io.Discard
	cmd.WaitDelay = time.Second
	output := &privateLimitedHostSnapshot{}
	cmd.Stdout = output
	defer clear(output.data)
	if err := cmd.Run(); err != nil || bounded.Err() != nil || len(output.data) < 2 || len(output.data) > privateHostSnapshotMaxBytes {
		return fail()
	}
	return append([]byte(nil), output.data...), nil
}
