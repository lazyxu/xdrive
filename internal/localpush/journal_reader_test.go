//go:build linux || windows

package localpush

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

func TestVerifiedJournalStreamIsBatchedAndReadOnly(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "photos")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 43; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("photo-%03d.jpg", i)), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	grant, err := PrepareRootGrant("https://server.test", "alice", 30, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	configDir := filepath.Join(base, "config")
	want, _, err := ScanInventoryToJournal(context.Background(), configDir, grant, InventoryScanner{BatchSize: 7})
	if err != nil {
		t.Fatal(err)
	}
	var seen, batches int
	got, err := StreamVerifiedInventoryJournal(context.Background(), configDir, grant, 13, func(rows []InventoryItem) error {
		if len(rows) == 0 || len(rows) > 13 {
			t.Fatalf("unbounded journal batch: %d", len(rows))
		}
		for _, row := range rows {
			if row.NativeIdentity == nil || row.NativeIdentity.Key == "" || row.Path == "" {
				t.Fatalf("invalid native journal entry: %+v", row)
			}
		}
		seen += len(rows)
		batches++
		return nil
	})
	if err != nil || got.SnapshotSHA256 != want.SnapshotSHA256 || got.MissingInferenceSafe ||
		seen != 43 || batches != 4 {
		t.Fatalf("invalid stream: %+v seen=%d batches=%d err=%v", got, seen, batches, err)
	}
	if _, err := StreamVerifiedInventoryJournal(context.Background(), configDir, grant, 501,
		func([]InventoryItem) error { return nil }); err == nil {
		t.Fatal("invalid unbounded callback batch was accepted")
	}
}

func TestVerifiedJournalStreamCancelsWithoutConfirmingCompletion(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "folder")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 7; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("file-%d", i)), []byte("a"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	grant, err := PrepareRootGrant("https://server.test", "alice", 31, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	configDir := filepath.Join(base, "config")
	if _, _, err := ScanInventoryToJournal(context.Background(), configDir, grant, InventoryScanner{}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	batches := 0
	if _, err := StreamVerifiedInventoryJournal(ctx, configDir, grant, 1, func([]InventoryItem) error {
		batches++
		cancel()
		return nil
	}); !errors.Is(err, context.Canceled) || batches != 1 {
		t.Fatalf("cancelled journal stream was accepted: batches=%d err=%v", batches, err)
	}
	verified, err := VerifyInventoryJournal(context.Background(), configDir, grant)
	if err != nil || verified.Items != 7 {
		t.Fatalf("cancelled reader changed completed journal: %+v %v", verified, err)
	}
}

func TestVerifiedJournalStreamRejectsTamperingBeforeCallback(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "folder")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "file"), []byte("a"), 0o600); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://server.test", "alice", 32, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	configDir := filepath.Join(base, "config")
	snapshot, _, err := ScanInventoryToJournal(context.Background(), configDir, grant, InventoryScanner{})
	if err != nil {
		t.Fatal(err)
	}
	dir, err := inventoryJournalDir(configDir, grant)
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(filepath.Join(dir, snapshot.SnapshotName), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString("tampered\n"); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	invoked := false
	_, err = StreamVerifiedInventoryJournal(context.Background(), configDir, grant, 2,
		func([]InventoryItem) error {
			invoked = true
			return nil
		})
	if err == nil || invoked {
		t.Fatalf("tampered journal emitted data: called=%t err=%v", invoked, err)
	}
}
