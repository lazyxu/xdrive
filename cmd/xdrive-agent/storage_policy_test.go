package main

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/userconfig"
)

func TestMountOptionsFromConfig(t *testing.T) {
	cfg := userconfig.Config{
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
}
