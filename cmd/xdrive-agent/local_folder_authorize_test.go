package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLocalFolderBoundaryProtectsMountAndCredentials(t *testing.T) {
	base := t.TempDir()
	photos := filepath.Join(base, "photos")
	mount := filepath.Join(base, "xdriveMount")
	secret := filepath.Join(base, "config", "xdrive")
	for _, path := range []string{photos, mount, secret} {
		if err := os.MkdirAll(path, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := validateLocalFolderBoundaries(photos, mount, secret); err != nil {
		t.Fatalf("unrelated photos directory rejected: %v", err)
	}
	for _, path := range []string{mount, filepath.Join(mount, "more"), secret,
		filepath.Dir(secret), base} {
		if err := validateLocalFolderBoundaries(path, mount, secret); err == nil {
			t.Fatalf("unsafe overlapping local folder was authorized: %s", path)
		}
	}
	if err := validateLocalFolderBoundaries("relative", mount, secret); err == nil {
		t.Fatal("relative path authorized")
	}
}
