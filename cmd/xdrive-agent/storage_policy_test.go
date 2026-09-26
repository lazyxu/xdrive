package main

import (
	"path/filepath"
	"testing"

	"github.com/lazyxu/xdrive/internal/userconfig"
)

func TestMountOptionsFromConfig(t *testing.T) {
	cfg := userconfig.Config{
		Server:          "https://drive.example.test",
		Username:        "alice",
		MountPath:       t.TempDir(),
		CacheLimitBytes: 5 << 30,
		SyncRules: []userconfig.SyncRule{
			{Path: "archive", Mode: userconfig.SyncModeExclude},
			{Path: "projects", Mode: userconfig.SyncModeAlwaysLocal},
		},
	}
	opts := mountOptionsFromConfig(cfg)
	if opts.CacheLimitBytes != 5<<30 {
		t.Fatalf("cache limit=%d", opts.CacheLimitBytes)
	}
	if len(opts.ExcludedPaths) != 1 || opts.ExcludedPaths[0] != "archive" {
		t.Fatalf("excluded=%v", opts.ExcludedPaths)
	}
	if len(opts.AlwaysLocalPaths) != 1 || opts.AlwaysLocalPaths[0] != "projects" {
		t.Fatalf("always local=%v", opts.AlwaysLocalPaths)
	}
	if opts.StatePath == "" || filepath.Ext(opts.StatePath) != ".json" {
		t.Fatalf("state path=%q", opts.StatePath)
	}
	same := mountOptionsFromConfig(cfg)
	if same.StatePath != opts.StatePath {
		t.Fatalf("state path is not stable: first=%q second=%q", opts.StatePath, same.StatePath)
	}
	other := cfg
	other.MountPath = t.TempDir()
	if otherPath := mountOptionsFromConfig(other).StatePath; otherPath == "" || otherPath == opts.StatePath {
		t.Fatalf("state path did not change with mount root: first=%q other=%q", opts.StatePath, otherPath)
	}
}
