//go:build linux || windows

package localpush

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestInventoryJournalCommitsOnlyCompleteValidRoot(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "original")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 43; i++ {
		name := filepath.Join(root, fmt.Sprintf("image-%03d.jpg", i))
		if err := os.WriteFile(name, []byte("data"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 11, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	configDir := filepath.Join(dir, "config")
	snap, summary, err := ScanInventoryToJournal(context.Background(), configDir, grant,
		InventoryScanner{BatchSize: 7})
	if err != nil {
		t.Fatal(err)
	}
	if !summary.Complete || summary.MissingInferenceSafe || snap.Items != 43 ||
		snap.WithNativeIdentity != 43 || snap.Bytes != 43*4 || snap.MissingInferenceSafe {
		t.Fatalf("journal must not imply remote delete authority: %+v %+v", snap, summary)
	}
	verified, err := VerifyInventoryJournal(context.Background(), configDir, grant)
	if err != nil || verified.SnapshotSHA256 != snap.SnapshotSHA256 {
		t.Fatalf("valid snapshot was not readable: %+v %v", verified, err)
	}
	journalDir, err := inventoryJournalDir(configDir, grant)
	if err != nil {
		t.Fatal(err)
	}
	snapshotFile := filepath.Join(journalDir, snap.SnapshotName)
	f, err := os.OpenFile(snapshotFile, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("tampered\n"); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyInventoryJournal(context.Background(), configDir, grant); err == nil {
		t.Fatal("tampered snapshot accepted")
	}
}

func TestInventoryJournalCancelledScanNeverReplacesPreviousSnapshot(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "folder")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "initial.txt"), []byte("1"), 0o600); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 12, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	configDir := filepath.Join(dir, "config")
	old, _, err := ScanInventoryToJournal(context.Background(), configDir, grant, InventoryScanner{BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"second.txt", "third.txt"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("2"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	writer, err := BeginInventoryJournal(configDir, grant)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Abort()
	scan, err := (InventoryScanner{IncludeNativeIdentity: true, BatchSize: 1}).ScanInventory(
		ctx, grant, func(items []InventoryItem) error {
			if err := writer.Append(items); err != nil {
				return err
			}
			cancel()
			return nil
		},
	)
	if !errors.Is(err, context.Canceled) || scan.Complete {
		t.Fatalf("cancelled scan declared complete: %+v %v", scan, err)
	}
	if _, err := writer.Commit(scan); err == nil {
		t.Fatal("partial inventory committed")
	}
	writer.Abort()
	verified, err := VerifyInventoryJournal(context.Background(), configDir, grant)
	if err != nil || verified.SnapshotName != old.SnapshotName || verified.Items != old.Items {
		t.Fatalf("partial/cancelled scan replaced durable snapshot: %+v %v", verified, err)
	}
}

func TestInventoryJournalRootReplacementCannotPublish(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "content")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 15, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	conf := filepath.Join(dir, "config")
	if _, _, err := ScanInventoryToJournal(context.Background(), conf, grant, InventoryScanner{}); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(root, root+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyInventoryJournal(context.Background(), conf, grant); !errors.Is(err, ErrRootChanged) {
		t.Fatalf("replaced root journal was trusted: %v", err)
	}
	if _, _, err := ScanInventoryToJournal(context.Background(), conf, grant, InventoryScanner{}); !errors.Is(err, ErrRootChanged) {
		t.Fatalf("replaced root was scanned as empty: %v", err)
	}
}

func TestInventoryJournalRetainsImmediatePreviousGeneration(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "source")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "one.txt"), []byte("1"), 0o600); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 20, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	configDir := filepath.Join(base, "config")
	first, _, err := ScanInventoryToJournal(context.Background(), configDir, grant, InventoryScanner{BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "two.txt"), []byte("2"), 0o600); err != nil {
		t.Fatal(err)
	}
	second, summary, err := ScanInventoryToJournal(context.Background(), configDir, grant, InventoryScanner{BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	if !summary.Complete || second.Items != 2 || second.Bytes != 2 ||
		first.SnapshotName == second.SnapshotName || second.MissingInferenceSafe {
		t.Fatalf("invalid committed generation: first=%+v second=%+v summary=%+v", first, second, summary)
	}
	dir, err := inventoryJournalDir(configDir, grant)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, first.SnapshotName)); err != nil {
		t.Fatalf("previous completed generation was prematurely pruned: %v", err)
	}
	previous, err := VerifyPreviousInventoryJournal(context.Background(), configDir, grant)
	if err != nil || previous.SnapshotName != first.SnapshotName {
		t.Fatalf("PREVIOUS must be the verified first generation: %+v %v", previous, err)
	}
	verified, err := VerifyInventoryJournal(context.Background(), configDir, grant)
	if err != nil || verified.SnapshotName != second.SnapshotName {
		t.Fatalf("CURRENT did not point to valid new generation: %+v, %v", verified, err)
	}
}

func TestInventoryJournalRejectsRootOverlapAndUnsafeEntryPath(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "source")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 21, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := BeginInventoryJournal(filepath.Join(root, "config"), grant); err == nil {
		t.Fatal("allowed the private journal to be scanned as a child of the Root")
	}
	if _, err := BeginInventoryJournal(base, grant); err == nil {
		t.Fatal("allowed a Root contained inside the private journal config tree")
	}
	conf := filepath.Join(base, "private-config")
	writer, err := BeginInventoryJournal(conf, grant)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Abort()
	bad := InventoryItem{
		Path: "../outside.txt", Kind: "file", Size: 1,
		NativeIdentity: &InventoryNativeIdentity{Key: fmt.Sprintf("%064x", 1)},
	}
	if err := writer.Append([]InventoryItem{bad}); err == nil {
		t.Fatal("accepted a journal entry escaping its authorized Root")
	}
	writer.Abort()
	dir, err := inventoryJournalDir(conf, grant)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "CURRENT.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unsafe journal entry published a manifest: %v", err)
	}
}

func TestInventoryJournal100kOptIn(t *testing.T) {
	if os.Getenv("XD_LOCALPUSH_STRESS_100K") != "1" {
		t.Skip("set XD_LOCALPUSH_STRESS_100K=1 for the native 100k filesystem acceptance test")
	}
	base := t.TempDir()
	root := filepath.Join(base, "100k")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	const count = 100000
	for i := 0; i < count; i++ {
		name := filepath.Join(root, fmt.Sprintf("item-%06d.dat", i))
		if err := os.WriteFile(name, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 100, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	snapshot, summary, err := ScanInventoryToJournal(context.Background(), filepath.Join(base, "config"),
		grant, InventoryScanner{BatchSize: 500})
	if err != nil {
		t.Fatal(err)
	}
	elapsed := time.Since(start)
	if !summary.Complete || summary.MissingInferenceSafe || snapshot.Items != count ||
		snapshot.WithNativeIdentity != count || snapshot.Bytes != count {
		t.Fatalf("100k scan did not preserve exact identity counts: %+v %+v", snapshot, summary)
	}
	t.Logf("native read-only 100k inventory and snapshot: %s for %d files", elapsed, count)
}
