//go:build linux

package caddyhostidentity

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// privateHostEnvFileEpoch distinguishes atomic Host .env Save A→B→A from
// an unmodified inode even when the managed-value SHA returns to A.
// Only the fixed Host-private .env path is used; the file content is NEVER
// read or exposed. Nofollow + before/open/after inode/mode checks fail closed
// on replacement, symlink or hardlink tricks during the local observation.
func privateHostEnvFileEpoch(path string) (string, error) {
	fail := func() (string, error) { return "", errUntrusted }
	if !privateHostSnapshotPathSafe(path, false, true) {
		return fail()
	}
	before, err := os.Lstat(path)
	if err != nil {
		return fail()
	}
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return fail()
	}
	defer syscall.Close(fd)
	var opened syscall.Stat_t
	if syscall.Fstat(fd, &opened) != nil || opened.Nlink != 1 ||
		opened.Uid != uint32(os.Geteuid()) || (opened.Mode&syscall.S_IFMT) != syscall.S_IFREG ||
		opened.Mode&0077 != 0 {
		return fail()
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(before, after) || !privateHostSnapshotPathSafe(path, false, true) {
		return fail()
	}
	previous, ok := before.Sys().(*syscall.Stat_t)
	current, ok2 := after.Sys().(*syscall.Stat_t)
	if !ok || !ok2 || *previous != opened || *current != opened {
		return fail()
	}
	// A domain-separated epoch is private and opaque; it does not reveal a
	// Host path or file contents to a caller. A source-only file epoch alone
	// is not a Caddy runtime reload epoch or signed Applied evidence.
	payload := fmt.Sprintf("xdrive.caddy.host-env-file-epoch.v1\n%d:%d:%d:%d:%d:%d:%d:%d\n",
		opened.Dev, opened.Ino, opened.Size,
		opened.Ctim.Sec, opened.Ctim.Nsec, opened.Mtim.Sec, opened.Mtim.Nsec, opened.Mode)
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:]), nil
}

// Recheck the exact same private Host .env inode/ctime/mtime on either side
// of the existing fixed Host snapshot invocation. An intervening rename or
// in-place edit is UNKNOWN, even if the final managed values are identical.
func privateRunFencedHostSnapshot(ctx context.Context, hostHome string) ([]byte, string, error) {
	fail := func() ([]byte, string, error) { return nil, "", errUntrusted }
	if ctx == nil || ctx.Err() != nil || hostHome == "" ||
		!filepath.IsAbs(hostHome) || filepath.Clean(hostHome) != hostHome {
		return fail()
	}
	env := filepath.Join(hostHome, "config", ".env")
	before, err := privateHostEnvFileEpoch(env)
	if err != nil {
		return fail()
	}
	raw, err := privateRunFixedHostSnapshot(ctx, hostHome)
	if err != nil {
		return fail()
	}
	after, err := privateHostEnvFileEpoch(env)
	if err != nil || before != after || ctx.Err() != nil {
		clear(raw)
		return fail()
	}
	return raw, before, nil
}
