//go:build linux || windows

package localpush

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

func TestInventoryJournalThirdGenerationPrunesOnlyOldest(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "photos")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 70, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	configDir := filepath.Join(base, "config")
	if _, err := VerifyPreviousInventoryJournal(context.Background(), configDir, grant); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("PREVIOUS must be absent before first scan: %v", err)
	}
	var snaps []InventoryJournalSnapshot
	for _, name := range []string{"one.txt", "two.txt", "three.txt"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("content"), 0o600); err != nil {
			t.Fatal(err)
		}
		snap, _, err := ScanInventoryToJournal(context.Background(), configDir, grant, InventoryScanner{BatchSize: 1})
		if err != nil {
			t.Fatal(err)
		}
		snaps = append(snaps, snap)
	}
	current, err := VerifyInventoryJournal(context.Background(), configDir, grant)
	if err != nil || current.SnapshotName != snaps[2].SnapshotName || current.Items != 3 {
		t.Fatalf("third generation not current: %+v %v", current, err)
	}
	prev, err := VerifyPreviousInventoryJournal(context.Background(), configDir, grant)
	if err != nil || prev.SnapshotName != snaps[1].SnapshotName || prev.Items != 2 {
		t.Fatalf("second generation not retained: %+v %v", prev, err)
	}
	dir, err := inventoryJournalDir(configDir, grant)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, snaps[0].SnapshotName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("oldest snapshot not pruned: %v", err)
	}
	f, err := os.OpenFile(filepath.Join(dir, prev.SnapshotName), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("tamper"); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyPreviousInventoryJournal(context.Background(), configDir, grant); err == nil {
		t.Fatal("tampered previous generation was trusted")
	}
	if _, err := VerifyInventoryJournal(context.Background(), configDir, grant); err != nil {
		t.Fatalf("valid current generation failed after older snapshot corruption: %v", err)
	}
}
