//go:build linux || windows

package localpush

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

func deltaFixture(t *testing.T) (string, RootGrant, string) {
	t.Helper()
	base := t.TempDir()
	root := filepath.Join(base, "root")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 77, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	return root, grant, filepath.Join(base, "private-config")
}

func deltaScan(t *testing.T, config string, grant RootGrant) InventoryJournalSnapshot {
	t.Helper()
	snapshot, _, err := ScanInventoryToJournal(context.Background(), config, grant, InventoryScanner{BatchSize: 3})
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestLocalInventoryDeltaTwoCompleteGenerationsAreConservative(t *testing.T) {
	root, grant, config := deltaFixture(t)
	for name, data := range map[string]string{
		"stable.txt": "same", "changed.txt": "old",
		"removed.txt": "before", "renamed-old.txt": "rename",
	} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	before := deltaScan(t, config, grant)
	if err := os.Remove(filepath.Join(root, "removed.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(root, "renamed-old.txt"), filepath.Join(root, "renamed-new.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "changed.txt"), []byte("new content (longer)"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "added.txt"), []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	after := deltaScan(t, config, grant)
	rows := make(map[string]InventoryDeltaKind)
	var calls int
	summary, err := StreamInventoryGenerationDelta(context.Background(), config, grant, 2,
		func(batch []InventoryDeltaCandidate) error {
			if len(batch) == 0 || len(batch) > 2 {
				t.Fatalf("unbounded delta callback: %d", len(batch))
			}
			calls++
			for _, row := range batch {
				path := ""
				if row.Current != nil {
					path = row.Current.Path
				} else if row.Previous != nil {
					path = row.Previous.Path
				}
				if _, duplicate := rows[path]; duplicate {
					t.Fatalf("duplicate path in observed delta: %s", path)
				}
				rows[path] = row.Kind
			}
			return nil
		})
	if err != nil || calls < 2 || summary.MissingInferenceSafe ||
		summary.Previous.SnapshotName != before.SnapshotName ||
		summary.Current.SnapshotName != after.SnapshotName ||
		summary.Added != 2 || summary.Changed != 1 ||
		summary.MetadataStable != 1 || summary.AbsentCandidates != 2 {
		t.Fatalf("incorrect conservative delta: %+v calls=%d err=%v", summary, calls, err)
	}
	for path, expected := range map[string]InventoryDeltaKind{
		"stable.txt":      InventoryDeltaStable,
		"changed.txt":     InventoryDeltaChanged,
		"removed.txt":     InventoryDeltaAbsent,
		"renamed-old.txt": InventoryDeltaAbsent,
		"renamed-new.txt": InventoryDeltaAdded,
		"added.txt":       InventoryDeltaAdded,
	} {
		if got := rows[path]; got != expected {
			t.Fatalf("path %s = %s, expected %s", path, got, expected)
		}
	}
}

func TestLocalInventoryDeltaRejectsMissingCorruptAndDuplicateGenerations(t *testing.T) {
	root, grant, config := deltaFixture(t)
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("a"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	calls := 0
	consume := func([]InventoryDeltaCandidate) error { calls++; return nil }
	if _, err := StreamInventoryGenerationDelta(context.Background(), config, grant, 1, consume); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("first inventory may not assert delta: %v", err)
	}
	dir, err := inventoryJournalDir(config, grant)
	if err != nil {
		t.Fatal(err)
	}
	head, err := os.ReadFile(filepath.Join(dir, inventoryJournalCurrent))
	if err != nil {
		t.Fatal(err)
	}
	// Crash between PREVIOUS and CURRENT head publication can leave both
	// heads pointing at the same snapshot: never treat this as two scans.
	if err := os.WriteFile(filepath.Join(dir, inventoryJournalPrevious), head, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := StreamInventoryGenerationDelta(context.Background(), config, grant, 1, consume); err == nil || calls != 0 {
		t.Fatalf("duplicate generation accepted or callback invoked: %v %d", err, calls)
	}
	if err := os.WriteFile(filepath.Join(root, "b.txt"), []byte("b"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	previous, err := VerifyPreviousInventoryJournal(context.Background(), config, grant)
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(filepath.Join(dir, previous.SnapshotName), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("tampered"); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := StreamInventoryGenerationDelta(context.Background(), config, grant, 1, consume); err == nil || calls != 0 {
		t.Fatalf("tampered predecessor accepted or callback invoked: %v %d", err, calls)
	}
}

func TestLocalInventoryDeltaCancellationAndRootReplacementFailClosed(t *testing.T) {
	root, grant, config := deltaFixture(t)
	if err := os.WriteFile(filepath.Join(root, "one.txt"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	if err := os.WriteFile(filepath.Join(root, "two.txt"), []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	calls := 0
	consume := func([]InventoryDeltaCandidate) error { calls++; return nil }
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := StreamInventoryGenerationDelta(ctx, config, grant, 2, consume); !errors.Is(err, context.Canceled) || calls != 0 {
		t.Fatalf("cancelled delta succeeded: err=%v calls=%d", err, calls)
	}
	if _, err := StreamInventoryGenerationDelta(context.Background(), config, grant, 0, nil); err == nil {
		t.Fatal("nil callback accepted")
	}
	if _, err := StreamInventoryGenerationDelta(context.Background(), config, grant, 501, consume); err == nil {
		t.Fatal("unbounded callback batch accepted")
	}
	// Replacing the authorized Root never means the old Root became empty.
	if err := os.Rename(root, root+"-moved"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := StreamInventoryGenerationDelta(context.Background(), config, grant, 2, consume); err == nil || calls != 0 {
		t.Fatalf("replaced Root produced a delta: %v calls=%d", err, calls)
	}
}

func TestInventoryDeltaDiskBucketIsMemoryBounded(t *testing.T) {
	dir := t.TempDir()
	file, err := os.OpenFile(inventoryDeltaBucketFile(dir, "before", 0), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	encoder := json.NewEncoder(file)
	found := 0
	for i := 0; found <= inventoryDeltaBucketLimit; i++ {
		path := fmt.Sprintf("adversarial-%d", i)
		if inventoryDeltaBucket(path) != 0 {
			continue
		}
		if err := encoder.Encode(InventoryCandidate{Path: path}); err != nil {
			t.Fatal(err)
		}
		found++
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := readInventoryDeltaBucket(dir, "before", 0); err == nil {
		t.Fatal("over-limit hash bucket accepted")
	}
}
