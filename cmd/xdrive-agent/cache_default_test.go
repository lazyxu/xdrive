package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

func TestAuthenticateUsesSafeDefaultCacheLimitAndPreservesExistingUnlimited(t *testing.T) {
	root := t.TempDir()
	configHome := filepath.Join(root, "config")
	home := filepath.Join(root, "home")
	t.Setenv("XDG_CONFIG_HOME", configHome)
	t.Setenv("APPDATA", configHome)
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")

	loginCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/login":
			loginCount++
			_ = json.NewEncoder(w).Encode(client.AuthResponse{
				AccessToken:      "access-token",
				RefreshToken:     "refresh-token",
				ExpiresIn:        900,
				RefreshExpiresIn: 86400,
				Username:         "alice",
				Role:             "user",
			})
		case "/api/v1/version":
			_ = json.NewEncoder(w).Encode(client.VersionInfo{Version: "snapshot"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	controller := newAgentController(ctx, cancel)
	mountPath := filepath.Join(root, "mount")

	if err := controller.Authenticate(server.URL, "alice", "password", mountPath); err != nil {
		t.Fatal(err)
	}
	cfg, err := userconfig.Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.CacheLimitBytes != userconfig.DefaultCacheLimitBytes {
		t.Fatalf("new login cache limit=%d want=%d", cfg.CacheLimitBytes, userconfig.DefaultCacheLimitBytes)
	}

	cfg.CacheLimitBytes = 0
	if err := userconfig.Save(cfg); err != nil {
		t.Fatal(err)
	}
	if err := controller.Authenticate(server.URL, "alice", "password", mountPath); err != nil {
		t.Fatal(err)
	}
	cfg, err = userconfig.Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.CacheLimitBytes != 0 {
		t.Fatalf("existing explicit unlimited cache was changed to %d", cfg.CacheLimitBytes)
	}
	if loginCount != 2 {
		t.Fatalf("login calls=%d want=2", loginCount)
	}
}
