package userconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func connectionIPConfigHome(t *testing.T) {
	t.Helper()
	root := t.TempDir()
	for _, key := range []string{"APPDATA", "XDG_CONFIG_HOME", "HOME", "USERPROFILE"} {
		t.Setenv(key, root)
	}
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
}

func TestConnectionIPConfigRoundTripAndNewClientValidation(t *testing.T) {
	connectionIPConfigHome(t)
	var cfg Config
	if err := json.Unmarshal([]byte(`{"server":"https://route.test:8443","session_id":"route-session","username":"alice","connection_ip":"127.0.0.1"}`), &cfg); err != nil {
		t.Fatal(err)
	}
	if err := cfg.ApplyAuth(client.AuthResponse{AccessToken: "fixture-access", Username: "alice", ExpiresIn: 900}, false); err != nil {
		t.Fatal(err)
	}
	if err := Save(cfg); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(loaded)
	if !strings.Contains(string(data), `"connection_ip":"127.0.0.1"`) {
		t.Fatal("chosen route disappeared across save/load")
	}
	cli, err := NewClient(loaded)
	if err != nil {
		t.Fatal(err)
	}
	if cli.HTTP.Transport == nil {
		t.Fatal("persisted route not applied to background client")
	}
	defer cli.HTTP.CloseIdleConnections()
}

func TestConnectionIPConfigRejectsInvalidPersistedRoute(t *testing.T) {
	connectionIPConfigHome(t)
	for _, ip := range []string{"private.test", "127.0.0.1:443", " 127.0.0.1"} {
		var cfg Config
		data, _ := json.Marshal(map[string]string{"server": "https://route.test", "session_id": "fixture", "connection_ip": ip})
		if err := json.Unmarshal(data, &cfg); err != nil {
			t.Fatal(err)
		}
		if err := Save(cfg); err == nil {
			t.Fatalf("Save accepted invalid IP %q", ip)
		}
		path, _ := Path()
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(); err == nil {
			t.Fatalf("Load accepted invalid IP %q", ip)
		}
	}
}
