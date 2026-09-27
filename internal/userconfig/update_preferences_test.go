package userconfig

import (
	"os"
	"path/filepath"
	"testing"
)

func TestUpdatePreferencesDefaultAndRoundTrip(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
	t.Setenv("APPDATA", filepath.Join(root, "config"))
	t.Setenv("HOME", filepath.Join(root, "home"))
	t.Setenv("USERPROFILE", filepath.Join(root, "home"))

	prefs, err := LoadUpdatePreferences()
	if err != nil {
		t.Fatal(err)
	}
	if prefs.Mode != UpdateModeManual {
		t.Fatalf("default update mode=%q want=%q", prefs.Mode, UpdateModeManual)
	}

	for _, mode := range []string{UpdateModeManual, UpdateModeCheck, UpdateModeDownload, UpdateModeInstall} {
		if err := SaveUpdatePreferences(UpdatePreferences{Mode: mode}); err != nil {
			t.Fatalf("save %s: %v", mode, err)
		}
		got, err := LoadUpdatePreferences()
		if err != nil {
			t.Fatalf("load %s: %v", mode, err)
		}
		if got.Mode != mode {
			t.Fatalf("round-trip mode=%q want=%q", got.Mode, mode)
		}
	}

	path, err := UpdatePreferencesPath()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("update preference file missing: %v", err)
	}
}

func TestUpdatePreferencesRejectInvalidMode(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
	t.Setenv("APPDATA", filepath.Join(root, "config"))
	t.Setenv("HOME", filepath.Join(root, "home"))
	t.Setenv("USERPROFILE", filepath.Join(root, "home"))

	if err := SaveUpdatePreferences(UpdatePreferences{Mode: "always"}); err == nil {
		t.Fatal("SaveUpdatePreferences accepted invalid mode")
	}

	dir, err := Dir()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "update-settings.json"), []byte("{\n  \"mode\": \"broken\"\n}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadUpdatePreferences(); err == nil {
		t.Fatal("LoadUpdatePreferences accepted invalid mode")
	}
}
