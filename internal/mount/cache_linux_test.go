//go:build linux

package mount

import "testing"

func TestLinuxCacheTelemetryIsExplicitlyUnsupported(t *testing.T) {
	stats, err := CacheUsage("/unused", Options{CacheLimitBytes: 123})
	if err != nil {
		t.Fatal(err)
	}
	if stats.Supported {
		t.Fatal("Linux FUSE must not claim a persistent hydration cache")
	}
	if stats.LimitBytes != 123 || stats.Reason == "" {
		t.Fatalf("stats=%+v", stats)
	}
	result, err := ReleaseReclaimableCache("/unused", Options{CacheLimitBytes: 123})
	if err != nil {
		t.Fatal(err)
	}
	if result.Stats.Supported || result.ReleasedBytes != 0 || result.ReleasedFiles != 0 {
		t.Fatalf("release=%+v", result)
	}
}
