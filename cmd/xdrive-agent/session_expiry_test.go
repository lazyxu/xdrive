package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/secretstore"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

func TestExpiredSessionBecomesReloginStateWithoutLosingSettings(t *testing.T) {
	root := t.TempDir()
	configHome := filepath.Join(root, "config")
	home := filepath.Join(root, "home")
	t.Setenv("XDG_CONFIG_HOME", configHome)
	t.Setenv("APPDATA", configHome)
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/refresh":
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid or expired refresh token"})
		case "/api/v1/version":
			_ = json.NewEncoder(w).Encode(client.VersionInfo{Version: "snapshot"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	mountPath := filepath.Join(root, "mount")
	cfg := userconfig.Config{
		Server:          server.URL,
		SessionID:       "expired-session",
		Username:        "alice",
		MountPath:       mountPath,
		CacheLimitBytes: 5 << 30,
		SyncRules:       []userconfig.SyncRule{{Path: "archive", Mode: userconfig.SyncModeExclude}},
	}
	if err := userconfig.Save(cfg); err != nil {
		t.Fatal(err)
	}
	dir, err := userconfig.Dir()
	if err != nil {
		t.Fatal(err)
	}
	if err := secretstore.Save(dir, cfg.SessionID, "xDrive test", secretstore.Credentials{
		AccessToken:      "access-old",
		AccessExpiresAt:  time.Now().Add(-time.Minute),
		RefreshToken:     "refresh-old",
		RefreshExpiresAt: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	controller := newAgentController(ctx, cancel)
	done := make(chan struct{})
	go func() {
		controller.Run()
		close(done)
	}()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("controller did not stop")
		}
	}()

	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		current, loadErr := userconfig.Load()
		snap := controller.Snapshot()
		if loadErr == nil && current.SessionInvalid && !snap.Configured {
			if snap.AuthStatus != "需要重新登录" || snap.SyncStatus != "等待登录" || snap.LastError != "" {
				t.Fatalf("snapshot=%+v", snap)
			}
			if snap.Server != server.URL || snap.Username != "alice" || snap.MountPath != mountPath {
				t.Fatalf("relogin context lost: %+v", snap)
			}
			if current.CacheLimitBytes != 5<<30 || len(current.SyncRules) != 1 || current.SyncRules[0].Path != "archive" {
				t.Fatalf("settings lost: %+v", current)
			}
			if _, err := secretstore.Load(dir, cfg.SessionID); !errors.Is(err, secretstore.ErrNotFound) {
				t.Fatalf("expired credential still exists: %v", err)
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("expired session was not converted to relogin state: snapshot=%+v", controller.Snapshot())
}

func TestLoadDesiredReturnsInvalidSessionContext(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(root, "config"))
	t.Setenv("APPDATA", filepath.Join(root, "config"))
	t.Setenv("HOME", filepath.Join(root, "home"))
	t.Setenv("USERPROFILE", filepath.Join(root, "home"))

	cfg := userconfig.Config{
		Server: "https://example.test", SessionID: "session-1", Username: "alice",
		MountPath: filepath.Join(root, "mount"), SessionInvalid: true,
	}
	if err := userconfig.Save(cfg); err != nil {
		t.Fatal(err)
	}
	d, err := loadDesired()
	if !errors.Is(err, userconfig.ErrSessionInvalid) {
		t.Fatalf("loadDesired error=%v", err)
	}
	if d.cfg.Server != cfg.Server || d.cfg.Username != cfg.Username || d.root != cfg.MountPath {
		t.Fatalf("desired context=%+v", d)
	}
}
