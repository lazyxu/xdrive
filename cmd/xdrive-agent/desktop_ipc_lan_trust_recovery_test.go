package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/userconfig"
)

func TestDesktopAgentNeverDowngradesCorruptedStoredLANRoot(t *testing.T) {
	root := t.TempDir()
	t.Setenv("APPDATA", root)
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("HOME", root)
	t.Setenv("USERPROFILE", root)

	path, err := userconfig.Path()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	// Syntactically valid config with a previously approved, now-corrupt root.
	// Neither the current system root set nor a network response may authorize
	// sending these credentials without a fresh explicit Desktop approval.
	raw := []byte("{\"server\":\"https://192.168.2.4:8443\"," +
		"\"session_id\":\"previous-login\",\"username\":\"alice\"," +
		"\"trusted_lan_root_pem\":\"not-a-valid-CA\"}")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	ctrl := &agentController{}
	err = ctrl.Authenticate("https://192.168.2.4:8443", "alice", "secret", "")
	if err == nil || !strings.Contains(err.Error(), "explicit reapproval") {
		t.Fatalf("corrupt previously trusted identity did not fail closed: %v", err)
	}
}
