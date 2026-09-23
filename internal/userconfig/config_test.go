package userconfig

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveLoadAndMountPath(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
	t.Setenv("APPDATA", filepath.Join(root, "config"))
	t.Setenv("HOME", filepath.Join(root, "home"))
	t.Setenv("USERPROFILE", filepath.Join(root, "home"))

	cfg := Config{Server: "https://example.test/", Token: "token", Username: "alice", Paused: true}
	if err := Save(cfg); err != nil {
		t.Fatal(err)
	}
	got, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.Server != "https://example.test" || got.Token != "token" || got.Username != "alice" || !got.Paused {
		t.Fatalf("unexpected config: %#v", got)
	}
	mountPath, err := EffectiveMountPath(got)
	if err != nil {
		t.Fatal(err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(home, "xDrive")
	if mountPath != want {
		t.Fatalf("mount path=%q want=%q", mountPath, want)
	}

	got.MountPath = filepath.Join(t.TempDir(), "custom")
	got.Paused = false
	if err := Save(got); err != nil {
		t.Fatal(err)
	}
	reloaded, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.MountPath != got.MountPath || reloaded.Paused {
		t.Fatalf("reloaded config=%#v", reloaded)
	}

	if err := Remove(); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(); err == nil {
		t.Fatal("Load succeeded after Remove")
	}
}
