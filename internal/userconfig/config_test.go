package userconfig

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestSaveLoadUsesSecureCredentialStore(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
	t.Setenv("APPDATA", filepath.Join(root, "config"))
	t.Setenv("HOME", filepath.Join(root, "home"))
	t.Setenv("USERPROFILE", filepath.Join(root, "home"))
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")

	cfg := Config{
		Server: "https://example.test/", Username: "alice",
		Role: "user", MustChangePassword: true, Paused: true,
	}
	resp := client.AuthResponse{
		AccessToken:        "access-secret",
		RefreshToken:       "refresh-secret",
		ExpiresIn:          900,
		RefreshExpiresIn:   86400,
		Username:           "alice",
		Role:               "user",
		MustChangePassword: true,
	}
	if err := cfg.ApplyAuth(resp, true); err != nil {
		t.Fatal(err)
	}
	if err := Save(cfg); err != nil {
		t.Fatal(err)
	}
	path, err := Path()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"access-secret", "refresh-secret", "access_token", "refresh_token"} {
		if strings.Contains(string(raw), secret) {
			t.Fatalf("config.json leaked %q: %s", secret, raw)
		}
	}

	got, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.Server != "https://example.test" || got.Username != "alice" ||
		got.Role != "user" || !got.MustChangePassword || !got.Paused || got.SessionID == "" {
		t.Fatalf("unexpected config: %#v", got)
	}
	if backend := CredentialBackend(got); backend == "unavailable" {
		t.Fatalf("credential backend=%q", backend)
	}

	mountPath, err := EffectiveMountPath(got)
	if err != nil {
		t.Fatal(err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(home, "xDrive"); mountPath != want {
		t.Fatalf("mount path=%q want=%q", mountPath, want)
	}

	got.MountPath = filepath.Join(t.TempDir(), "custom")
	got.Paused = false
	got.MustChangePassword = false
	if err := Save(got); err != nil {
		t.Fatal(err)
	}
	reloaded, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.MountPath != got.MountPath || reloaded.Paused || reloaded.MustChangePassword {
		t.Fatalf("reloaded config=%#v", reloaded)
	}

	if err := Remove(); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(); err == nil {
		t.Fatal("Load succeeded after Remove")
	}
}

func TestLoadMigratesPlaintextTokens(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
	t.Setenv("APPDATA", filepath.Join(root, "config"))
	t.Setenv("HOME", filepath.Join(root, "home"))
	t.Setenv("USERPROFILE", filepath.Join(root, "home"))
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	dir, err := Dir()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	legacy := `{
  "server":"https://legacy.example",
  "token":"legacy-access",
  "access_token":"legacy-access",
  "refresh_token":"legacy-refresh",
  "access_expires_at":"` + time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano) + `",
  "refresh_expires_at":"` + time.Now().Add(24*time.Hour).UTC().Format(time.RFC3339Nano) + `",
  "username":"legacy"
}`
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SessionID == "" {
		t.Fatal("migration did not create session id")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "legacy-access") || strings.Contains(string(raw), "legacy-refresh") {
		t.Fatalf("plaintext credential remained after migration: %s", raw)
	}
	if _, err := NewClient(cfg); err != nil {
		t.Fatalf("migrated credential cannot create client: %v", err)
	}
}
