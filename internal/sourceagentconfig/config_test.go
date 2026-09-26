package sourceagentconfig

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestConfigSaveLoadAndReady(t *testing.T) {
	t.Setenv(configDirEnv, t.TempDir())
	cfg := Config{
		Server:         " https://drive.example.com/ ",
		SessionID:      "session-1",
		Username:       " alice ",
		SourceID:       42,
		PersonalRoot:   filepath.Join(t.TempDir(), "personal"),
		PersonalRootID: "fs:personal:1:2",
		SharedRoot:     filepath.Join(t.TempDir(), "shared"),
		SharedRootID:   "fs:shared:1:3",
	}
	if err := Save(cfg); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Server != "https://drive.example.com" || loaded.Username != "alice" || loaded.SourceID != 42 {
		t.Fatalf("unexpected config: %+v", loaded)
	}
	if err := loaded.ReadyForRun(); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		path, err := Path()
		if err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm()&0o077 != 0 {
			t.Fatalf("config permissions=%o want private", info.Mode().Perm())
		}
	}
}

func TestConfigRejectsOverlappingRoots(t *testing.T) {
	t.Setenv(configDirEnv, t.TempDir())
	base := t.TempDir()
	cfg := Config{
		Server:       "https://drive.example.com",
		SessionID:    "session-1",
		PersonalRoot: base,
		SharedRoot:   filepath.Join(base, "nested"),
	}
	if err := Save(cfg); err == nil {
		t.Fatal("overlapping roots were accepted")
	}
}

func TestReadyForRunRequiresSourceAndRoot(t *testing.T) {
	cfg := Config{}
	if err := cfg.ReadyForRun(); err == nil {
		t.Fatal("missing source id was accepted")
	}
	cfg.SourceID = 1
	if err := cfg.ReadyForRun(); err == nil {
		t.Fatal("missing roots were accepted")
	}
	cfg.SharedRoot = "/volume1/photo"
	if err := cfg.ReadyForRun(); err == nil {
		t.Fatal("missing shared root identity was accepted")
	}
	cfg.SharedRootID = "fs:shared:1:2"
	if err := cfg.ReadyForRun(); err != nil {
		t.Fatal(err)
	}
}
