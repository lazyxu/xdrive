package userconfig

import (
	"path/filepath"
	"testing"
)

func TestStoragePolicyNormalizationAndValidation(t *testing.T) {
	cfg := Config{
		Server:    "https://example.test",
		SessionID: "session",
		SyncRules: []SyncRule{
			{Path: "Docs\\Team", Mode: SyncModeAlwaysLocal},
			{Path: "archive//2025", Mode: SyncModeExclude},
			{Path: "docs/team", Mode: SyncModeAlwaysLocal},
		},
		CacheLimitBytes: 8 << 30,
	}
	if err := normalizeStoragePolicy(&cfg); err != nil {
		t.Fatal(err)
	}
	if len(cfg.SyncRules) != 2 {
		t.Fatalf("rules=%+v", cfg.SyncRules)
	}
	if cfg.SyncRules[0].Path != "archive/2025" || cfg.SyncRules[0].Mode != SyncModeExclude {
		t.Fatalf("first rule=%+v", cfg.SyncRules[0])
	}
	if cfg.SyncRules[1].Path != "docs/team" || cfg.SyncRules[1].Mode != SyncModeAlwaysLocal {
		t.Fatalf("second rule=%+v", cfg.SyncRules[1])
	}
	if got := cfg.StoragePolicyKey(); got == "" {
		t.Fatal("empty storage policy key")
	}

	for _, bad := range []string{"", ".", "..", "../outside", "/absolute", "C:/drive"} {
		if _, err := NormalizeSyncRulePath(bad); err == nil {
			t.Fatalf("NormalizeSyncRulePath(%q) succeeded", bad)
		}
	}

	cfg.SyncRules = []SyncRule{
		{Path: "archive", Mode: SyncModeExclude},
		{Path: "archive/keep", Mode: SyncModeAlwaysLocal},
	}
	if err := normalizeStoragePolicy(&cfg); err == nil {
		t.Fatal("always-local child inside excluded parent was accepted")
	}

	cfg.SyncRules = []SyncRule{
		{Path: "docs", Mode: SyncModeAlwaysLocal},
		{Path: "docs/private", Mode: SyncModeExclude},
	}
	if err := normalizeStoragePolicy(&cfg); err != nil {
		t.Fatalf("excluded child inside always-local parent should be supported: %v", err)
	}

	cfg.CacheLimitBytes = -1
	if err := normalizeStoragePolicy(&cfg); err == nil {
		t.Fatal("negative cache limit was accepted")
	}
}

func TestSaveLoadStoragePolicy(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
	t.Setenv("APPDATA", filepath.Join(root, "config"))
	t.Setenv("HOME", filepath.Join(root, "home"))
	t.Setenv("USERPROFILE", filepath.Join(root, "home"))
	cfg := Config{
		Server:          "https://example.test",
		SessionID:       "storage-policy-session",
		Username:        "alice",
		CacheLimitBytes: 12 << 30,
		SyncRules: []SyncRule{
			{Path: "Archive", Mode: SyncModeExclude},
			{Path: "Projects", Mode: SyncModeAlwaysLocal},
		},
	}
	if err := Save(cfg); err != nil {
		t.Fatal(err)
	}
	got, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.CacheLimitBytes != 12<<30 || len(got.SyncRules) != 2 {
		t.Fatalf("loaded policy=%+v cache=%d", got.SyncRules, got.CacheLimitBytes)
	}
	if got.SyncRules[0].Path != "Archive" || got.SyncRules[0].Mode != SyncModeExclude {
		t.Fatalf("exclude rule=%+v", got.SyncRules[0])
	}
	if got.SyncRules[1].Path != "Projects" || got.SyncRules[1].Mode != SyncModeAlwaysLocal {
		t.Fatalf("always-local rule=%+v", got.SyncRules[1])
	}
}
