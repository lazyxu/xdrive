//go:build linux

package secretstore

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLinuxFallbackRoundTripPermissions(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	root := t.TempDir()
	sessionID := "session-123"
	want := Credentials{
		RefreshToken:     "refresh-secret-value",
		RefreshExpiresAt: time.Now().Add(24 * time.Hour).UTC().Truncate(time.Second),
	}
	if err := Save(root, sessionID, "xDrive test", want); err != nil {
		t.Fatal(err)
	}
	path, err := fallbackPath(root, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("credential mode=%o want=600", got)
	}
	dirInfo, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if got := dirInfo.Mode().Perm(); got != 0o700 {
		t.Fatalf("credential directory mode=%o want=700", got)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), want.RefreshToken) {
		t.Fatal("fallback credential did not contain expected payload")
	}
	got, err := Load(root, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if got.RefreshToken != want.RefreshToken || !got.RefreshExpiresAt.Equal(want.RefreshExpiresAt) {
		t.Fatalf("got=%+v want=%+v", got, want)
	}
	if Backend(root, sessionID) != "file-0600" {
		t.Fatalf("backend=%q", Backend(root, sessionID))
	}
	if err := Delete(root, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(root, sessionID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("load after delete err=%v", err)
	}
}
