package userconfig

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/secretstore"
)

func TestNewClientSharesRefreshAcrossConcurrentCallers(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
	t.Setenv("APPDATA", filepath.Join(root, "config"))
	t.Setenv("HOME", filepath.Join(root, "home"))
	t.Setenv("USERPROFILE", filepath.Join(root, "home"))
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")

	var mu sync.Mutex
	refreshCalls := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/refresh":
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			mu.Lock()
			refreshCalls++
			mu.Unlock()
			if body["refresh_token"] != "refresh-old" {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"invalid or expired refresh token"}`))
				return
			}
			time.Sleep(25 * time.Millisecond)
			_ = json.NewEncoder(w).Encode(client.AuthResponse{
				AccessToken: "access-new", RefreshToken: "refresh-new",
				ExpiresIn: 900, RefreshExpiresIn: 3600,
			})
		case "/api/v1/nodes/root":
			if got := r.Header.Get("Authorization"); got != "Bearer access-new" {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"invalid access token"}`))
				return
			}
			_ = json.NewEncoder(w).Encode(client.Node{ID: 1, Type: "dir", Revision: 1})
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	cfg := Config{Server: ts.URL, SessionID: "shared-refresh-session", Username: "alice"}
	dir, err := Dir()
	if err != nil {
		t.Fatal(err)
	}
	if err := secretstore.Save(dir, cfg.SessionID, credentialLabel(cfg), secretstore.Credentials{
		AccessToken: "access-old", AccessExpiresAt: time.Now().Add(-time.Minute),
		RefreshToken: "refresh-old", RefreshExpiresAt: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	first, err := NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	errs := make(chan error, 2)
	for _, cli := range []*client.Client{first, second} {
		go func(cli *client.Client) {
			<-start
			_, err := cli.Root(context.Background())
			errs <- err
		}(cli)
	}
	close(start)
	for range 2 {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}

	mu.Lock()
	calls := refreshCalls
	mu.Unlock()
	if calls != 1 {
		t.Fatalf("refresh calls=%d want=1", calls)
	}
	creds, err := secretstore.Load(dir, cfg.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if creds.AccessToken != "access-new" || creds.RefreshToken != "refresh-new" || creds.AccessExpiresAt.IsZero() {
		t.Fatalf("persisted credentials=%+v", creds)
	}
}

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
