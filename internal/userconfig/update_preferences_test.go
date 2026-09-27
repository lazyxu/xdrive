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
	if prefs.Source != UpdateSourceGitHub {
		t.Fatalf("default update source=%q want=%q", prefs.Source, UpdateSourceGitHub)
	}

	for _, mode := range []string{UpdateModeManual, UpdateModeCheck, UpdateModeDownload, UpdateModeInstall} {
		for _, source := range []string{UpdateSourceGitHub, UpdateSourceGitLab} {
			if err := SaveUpdatePreferences(UpdatePreferences{Mode: mode, Source: source}); err != nil {
				t.Fatalf("save %s/%s: %v", mode, source, err)
			}
			got, err := LoadUpdatePreferences()
			if err != nil {
				t.Fatalf("load %s/%s: %v", mode, source, err)
			}
			if got.Mode != mode || got.Source != source {
				t.Fatalf("round-trip=%+v want mode=%q source=%q", got, mode, source)
			}
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

func TestUpdatePreferencesLegacyFileDefaultsToGitHub(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
	t.Setenv("APPDATA", filepath.Join(root, "config"))
	t.Setenv("HOME", filepath.Join(root, "home"))
	t.Setenv("USERPROFILE", filepath.Join(root, "home"))

	dir, err := Dir()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "update-settings.json"), []byte("{\n  \"mode\": \"check\"\n}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	prefs, err := LoadUpdatePreferences()
	if err != nil {
		t.Fatal(err)
	}
	if prefs.Mode != UpdateModeCheck || prefs.Source != UpdateSourceGitHub {
		t.Fatalf("legacy prefs=%+v", prefs)
	}
}

func TestUpdatePreferencesRejectInvalidSource(t *testing.T) {
	if err := SaveUpdatePreferences(UpdatePreferences{Mode: UpdateModeManual, Source: "mirror"}); err == nil {
		t.Fatal("SaveUpdatePreferences accepted invalid source")
	}
}
