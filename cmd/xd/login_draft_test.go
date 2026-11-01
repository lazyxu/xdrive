package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestXDLoginDraftRoundTripDoesNotPersistCredentials(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "xd")
	input := xdLoginDraft{Version: 1, Server: "https://192.168.2.4:8443/", Username: "owner"}
	if err := saveXDLoginDraftToDir(dir, input); err != nil {
		t.Fatal(err)
	}
	result, err := readXDLoginDraftFromDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if result.Server != "https://192.168.2.4:8443" || result.Username != "owner" {
		t.Fatalf("unexpected restored login hints: %#v", result)
	}
	file := filepath.Join(dir, xdLoginDraftFile)
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) != 3 || fields["version"] != float64(1) ||
		fields["username"] != "owner" || fields["server"] != result.Server {
		t.Fatalf("login hints contain unexpected fields: %v", fields)
	}
	for _, secret := range []string{"password", "refresh", "access_token", "bearer", "session_id"} {
		if strings.Contains(strings.ToLower(string(data)), secret) {
			t.Fatalf("login hints unexpectedly persist %s", secret)
		}
	}
	if runtime.GOOS != "windows" {
		info, err := os.Lstat(file)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("login hints file permission = %o, want 0600", info.Mode().Perm())
		}
	}
}

func TestXDLoginDraftRejectsCorruptionAndSecretBearingJSON(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, xdLoginDraftFile)
	for _, content := range []string{
		"not-json",
		`{"version":2,"server":"https://drive.example","username":"owner"}`,
		`{"version":1,"server":"http://drive.example","username":"owner"}`,
		`{"version":1,"server":"https://user:pass@drive.example","username":"owner"}`,
		`{"version":1,"server":"https://drive.example/?secret=1","username":"owner"}`,
		`{"version":1,"server":"https://drive.example","username":"bad\nowner"}`,
		`{"version":1,"server":"https://drive.example","username":"owner","password":"secret"}`,
		strings.Repeat("x", xdLoginDraftMaxBytes+1),
		`{"version":1,"server":"https://drive.example","username":"owner"}{"password":"x"}`,
	} {
		if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := readXDLoginDraftFromDir(dir); err == nil {
			t.Fatalf("accepted corrupt or secret-bearing JSON")
		}
	}
	if runtime.GOOS != "windows" {
		if err := os.Remove(p); err != nil {
			t.Fatal(err)
		}
		target := filepath.Join(dir, "other")
		if err := os.WriteFile(target, []byte("fake"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(target, p); err != nil {
			t.Fatal(err)
		}
		if _, err := readXDLoginDraftFromDir(dir); err == nil {
			t.Fatal("accepted symlinked login hints")
		}
	}
}

func TestXDLoginDraftRejectsInvalidInputWithoutOverwritingPriorHint(t *testing.T) {
	dir := t.TempDir()
	original := xdLoginDraft{Version: 1, Server: "https://drive.example", Username: "owner"}
	if err := saveXDLoginDraftToDir(dir, original); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []xdLoginDraft{
		{Version: 1, Server: "http://drive.example", Username: "owner"},
		{Version: 1, Server: "https://drive.example", Username: " owner"},
		{Version: 1, Server: "https://drive.example", Username: "bad\x00user"},
		{Version: 1, Server: "https://drive.example", Username: strings.Repeat("中", 50)},
		{Version: 3, Server: "https://drive.example", Username: "owner"},
	} {
		if err := saveXDLoginDraftToDir(dir, bad); err == nil {
			t.Fatalf("accepted invalid draft %#v", bad)
		}
	}
	got, err := readXDLoginDraftFromDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got != original {
		t.Fatalf("invalid input overwrote previous valid draft: %#v", got)
	}
}

func TestXDLoginTargetUsesOnlyMatchingServerHint(t *testing.T) {
	saved := xdLoginDraft{Version: 1, Server: "https://drive.example:8443", Username: "owner"}
	for _, tc := range []struct {
		server, username         string
		wantServer, wantUsername string
		fail                     bool
	}{
		{"", "", "https://drive.example:8443", "owner", false},
		{"https://drive.example:8443/", "", "https://drive.example:8443", "owner", false},
		{"", "other", "https://drive.example:8443", "other", false},
		{"https://another.example", "", "", "", true},
		{"https://another.example", "other", "https://another.example", "other", false},
		{"http://drive.example:8443", "owner", "", "", true},
		{"https://drive.example:8443", "x\nother", "", "", true},
		{"", strings.Repeat("a", 129), "", "", true},
	} {
		server, username, err := resolveXDLoginTarget(tc.server, tc.username, saved)
		if tc.fail {
			if err == nil {
				t.Fatalf("accepted (%q, %q) -> (%q, %q)", tc.server, tc.username, server, username)
			}
			continue
		}
		if err != nil || server != tc.wantServer || username != tc.wantUsername {
			t.Fatalf("resolved (%q, %q) -> (%q, %q), %v", tc.server, tc.username, server, username, err)
		}
	}
	if _, _, err := resolveXDLoginTarget("", "", xdLoginDraft{}); err == nil {
		t.Fatal("empty untrusted draft unexpectedly granted a server")
	}
}

func TestXDLoginDraftReadOnlyNonSecretCleanup(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, xdLoginDraftFile)
	if err := saveXDLoginDraftToDir(dir, xdLoginDraft{Version: 1, Server: "https://drive.example", Username: "owner"}); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if _, err := readXDLoginDraftFromDir(dir); !os.IsNotExist(err) {
		t.Fatalf("expected missing draft after explicit removal, got %v", err)
	}
}
