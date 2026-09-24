//go:build linux

package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalReadyChecksUploadStagingDirectory(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root bypasses directory permission bits")
	}

	root := t.TempDir()
	store, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	staging := filepath.Join(root, UploadStagingDir)
	if err := os.Chmod(staging, 0o500); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(staging, 0o750)

	if err := store.Ready(context.Background()); err == nil {
		t.Fatal("expected readiness check to reject a non-writable upload staging directory")
	}
	if _, err := NewLocal(root); err == nil {
		t.Fatal("expected startup check to reject a non-writable upload staging directory")
	}
}
