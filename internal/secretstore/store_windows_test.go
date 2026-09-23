//go:build windows

package secretstore

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWindowsDPAPIRoundTrip(t *testing.T) {
	root := t.TempDir()
	sessionID := "session-win-123"
	want := Credentials{
		RefreshToken:     "refresh-secret-value",
		RefreshExpiresAt: time.Now().Add(24 * time.Hour).UTC().Truncate(time.Second),
	}
	if err := Save(root, sessionID, "xDrive test", want); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(credentialDir(root), sessionID+".dpapi")
	ciphertext, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(ciphertext, []byte(want.RefreshToken)) {
		t.Fatal("DPAPI credential contains plaintext refresh token")
	}
	got, err := Load(root, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if got.RefreshToken != want.RefreshToken || !got.RefreshExpiresAt.Equal(want.RefreshExpiresAt) {
		t.Fatalf("got=%+v want=%+v", got, want)
	}
	if Backend(root, sessionID) != "windows-dpapi" {
		t.Fatalf("backend=%q", Backend(root, sessionID))
	}
	if err := Delete(root, sessionID); err != nil {
		t.Fatal(err)
	}
}
