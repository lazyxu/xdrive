package sourceagentconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/synology"
)

func TestConfigSaveLoadAndReady(t *testing.T) {
	t.Setenv(configDirEnv, t.TempDir())
	cfg := Config{
		Server:                  " https://drive.example.com/ ",
		SessionID:               "session-1",
		Username:                " alice ",
		SourceID:                42,
		PersonalRoot:            filepath.Join(t.TempDir(), "personal"),
		PersonalRootID:          "fs:personal:1:2",
		PersonalRootFingerprint: "root:btime:personal:2:3:4",
		SharedRoot:              filepath.Join(t.TempDir(), "shared"),
		SharedRootID:            "fs:shared:1:3",
		SharedRootFingerprint:   "root:btime:shared:3:4:5",
	}
	if err := Save(cfg); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Server != "https://drive.example.com" || loaded.Username != "alice" || loaded.SourceID != 42 ||
		loaded.PersonalRootFingerprint != cfg.PersonalRootFingerprint ||
		loaded.SharedRootFingerprint != cfg.SharedRootFingerprint {
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

func TestIdentityDirStableAndIsolated(t *testing.T) {
	t.Setenv(configDirEnv, t.TempDir())
	base := Config{
		Server:   "https://drive.example.com",
		Username: "alice",
		SourceID: 42,
	}
	first, err := IdentityDir(base)
	if err != nil {
		t.Fatal(err)
	}
	second, err := IdentityDir(base)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("identity dir changed: %q != %q", first, second)
	}
	other := base
	other.SourceID = 43
	third, err := IdentityDir(other)
	if err != nil {
		t.Fatal(err)
	}
	if third == first {
		t.Fatal("different source ids share identity state")
	}
	other = base
	other.Server = "https://other.example.com"
	fourth, err := IdentityDir(other)
	if err != nil {
		t.Fatal(err)
	}
	if fourth == first {
		t.Fatal("different servers share identity state")
	}
}

func TestSynologyCredentialStoredOutsideConfig(t *testing.T) {
	t.Setenv(configDirEnv, t.TempDir())
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	cfg := Config{Server: "https://drive.example.com", SessionID: "session-1"}
	credential := synology.Credential{
		BaseURL:  "https://nas.example.com:5001",
		Username: "photo-reader",
		Password: "super-secret-password",
	}
	if err := SaveSynologyCredential(&cfg, credential); err != nil {
		t.Fatal(err)
	}
	if err := Save(cfg); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(mustConfigPath(t))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), credential.Password) {
		t.Fatal("Synology password leaked into config.json")
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	if raw["synology_base_url"] != credential.BaseURL || raw["synology_username"] != credential.Username {
		t.Fatalf("config metadata=%v", raw)
	}
	loaded, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	got, err := LoadSynologyCredential(loaded)
	if err != nil {
		t.Fatal(err)
	}
	if got != credential {
		t.Fatalf("credential=%+v want=%+v", got, credential)
	}
	wantBackend := "file-0600"
	if runtime.GOOS == "windows" {
		wantBackend = "windows-dpapi"
	}
	if backend := SynologyCredentialBackend(loaded); backend != wantBackend {
		t.Fatalf("backend=%q want=%q", backend, wantBackend)
	}
}

func mustConfigPath(t *testing.T) string {
	t.Helper()
	path, err := Path()
	if err != nil {
		t.Fatal(err)
	}
	return path
}
