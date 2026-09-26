//go:build linux

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/sourceagent"
	"github.com/lazyxu/xdrive/internal/sourceagentconfig"
)

func TestMigrateRootFingerprintsSeedsLegacyConfig(t *testing.T) {
	root := t.TempDir()
	legacy, err := sourceagent.RootIdentity("shared", root)
	if err != nil {
		t.Fatal(err)
	}
	cfg := sourceagentconfig.Config{
		SharedRoot:   root,
		SharedRootID: legacy,
	}
	changed, err := migrateRootFingerprints(&cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || cfg.SharedRootFingerprint == "" {
		t.Fatalf("fingerprint migration did not seed config: %+v", cfg)
	}
	first := cfg.SharedRootFingerprint

	changed, err = migrateRootFingerprints(&cfg)
	if err != nil {
		t.Fatal(err)
	}
	if changed || cfg.SharedRootFingerprint != first {
		t.Fatalf("stable root unexpectedly changed: changed=%t cfg=%+v", changed, cfg)
	}
}

func TestMigrateRootFingerprintsRejectsReplacedRoot(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "photo")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	legacy, err := sourceagent.RootIdentity("shared", root)
	if err != nil {
		t.Fatal(err)
	}
	fingerprint, err := sourceagent.RootFingerprint("shared", root)
	if err != nil {
		t.Fatal(err)
	}
	cfg := sourceagentconfig.Config{
		SharedRoot:            root,
		SharedRootID:          legacy,
		SharedRootFingerprint: fingerprint,
	}

	old := filepath.Join(parent, "old-photo")
	if err := os.Rename(root, old); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := migrateRootFingerprints(&cfg); err == nil {
		t.Fatal("replaced root was accepted")
	}
}

func TestMigrateRootFingerprintsAllowsLegacyDeviceChange(t *testing.T) {
	root := t.TempDir()
	currentLegacy, err := sourceagent.RootIdentity("shared", root)
	if err != nil {
		t.Fatal(err)
	}
	currentFingerprint, err := sourceagent.RootFingerprint("shared", root)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(currentFingerprint, "root:btime:") {
		t.Skip("filesystem does not expose statx birth time; cross-device migration intentionally fails closed")
	}
	_, inode, ok := sourceagent.ParseLegacyRootIdentity("shared", currentLegacy)
	if !ok {
		t.Fatalf("cannot parse current root identity %q", currentLegacy)
	}
	cfg := sourceagentconfig.Config{
		SharedRoot:   root,
		SharedRootID: fmt.Sprintf("fs:shared:%d:%d", uint64(999999), inode),
	}
	changed, err := migrateRootFingerprints(&cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || cfg.SharedRootFingerprint == "" {
		t.Fatalf("device-change migration failed: %+v", cfg)
	}
}
