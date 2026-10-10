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

func TestInventoryCandidateHardlinkPathsAndSafeRenameHints(t *testing.T) {
	root := filepath.Join(t.TempDir(), "data")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	original := filepath.Join(root, "one.txt")
	alias := filepath.Join(root, "two.txt")
	if err := os.WriteFile(original, []byte("same object"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(original, alias); err != nil {
		t.Skipf("hard links unavailable: %v", err)
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 44, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(t.TempDir(), "config")
	if _, _, err := ScanInventoryToJournal(context.Background(), config, grant,
		InventoryScanner{BatchSize: 1}); err != nil {
		t.Fatal(err)
	}
	rows := make(map[string]InventoryCandidate)
	summary, err := StreamInventoryCandidates(context.Background(), config, grant, 1,
		func(batch []InventoryCandidate) error {
			if len(batch) != 1 {
				t.Fatalf("unbounded candidates: %d", len(batch))
			}
			rows[batch[0].Path] = batch[0]
			return nil
		})
	if err != nil || summary.Items != 2 || summary.NeedsContentHash != 2 ||
		summary.MissingInferenceSafe {
		t.Fatalf("incorrect candidate totals: %+v %v", summary, err)
	}
	a, b := rows["one.txt"], rows["two.txt"]
	if a.PathKey == "" || b.PathKey == "" || a.PathKey == b.PathKey ||
		a.NativeIdentityKey != b.NativeIdentityKey || a.LinkCount < 2 ||
		a.RenameHintSafe || b.RenameHintSafe {
		t.Fatalf("hard links must remain distinct logical paths, without rename authority: %+v %+v", a, b)
	}
	if err := os.Remove(alias); err != nil {
		t.Fatal(err)
	}
	renamed := filepath.Join(root, "renamed.txt")
	if err := os.Rename(original, renamed); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ScanInventoryToJournal(context.Background(), config, grant,
		InventoryScanner{BatchSize: 1}); err != nil {
		t.Fatal(err)
	}
	rows = make(map[string]InventoryCandidate)
	_, err = StreamInventoryCandidates(context.Background(), config, grant, 2,
		func(batch []InventoryCandidate) error {
			for _, item := range batch {
				rows[item.Path] = item
			}
			return nil
		})
	if err != nil {
		t.Fatal(err)
	}
	next := rows["renamed.txt"]
	if next.PathKey == a.PathKey || next.NativeIdentityKey != a.NativeIdentityKey ||
		next.RenameHintSafe != next.StrongNativeIdentity || next.LinkCount != 1 {
		t.Fatalf("rename must preserve object hint but change path key: before=%+v after=%+v", a, next)
	}
}

func TestInventoryCandidatesAreBatchedAndIgnoreSafe(t *testing.T) {
	root := filepath.Join(t.TempDir(), "source")
	if err := os.MkdirAll(filepath.Join(root, "private"), 0o700); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 43; i++ {
		name := fmt.Sprintf("image-%03d.jpg", i)
		if err := os.WriteFile(filepath.Join(root, name), []byte("content"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "private", "do-not-sync.txt"), []byte("ignored"), 0o600); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 45, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(t.TempDir(), "config")
	if _, _, err := ScanInventoryToJournal(context.Background(), config, grant,
		InventoryScanner{IgnoreRules: "private/", BatchSize: 7}); err != nil {
		t.Fatal(err)
	}
	var callbackCount, ignored, hashRequired int
	summary, err := StreamInventoryCandidates(context.Background(), config, grant, 7,
		func(batch []InventoryCandidate) error {
			if len(batch) == 0 || len(batch) > 7 {
				t.Fatalf("unexpected candidate batch: %d", len(batch))
			}
			callbackCount++
			for _, candidate := range batch {
				if candidate.Ignored {
					ignored++
					if candidate.NeedsContentHash {
						t.Fatal("ignored item requested original-file hashing")
					}
				}
				if candidate.NeedsContentHash {
					hashRequired++
				}
				if candidate.PathKey == "" || candidate.NativeIdentityKey == "" {
					t.Fatalf("missing path/object evidence: %+v", candidate)
				}
			}
			return nil
		})
	if err != nil || summary.Items != 45 || summary.IgnoredItems != int64(ignored) ||
		summary.NeedsContentHash != int64(hashRequired) || hashRequired != 43 ||
		callbackCount != 7 || summary.MissingInferenceSafe {
		t.Fatalf("incorrect bounded candidate projection: %+v ignored=%d hashes=%d batches=%d err=%v",
			summary, ignored, hashRequired, callbackCount, err)
	}
}

func TestCandidateValidationRejectsUnsafeAliases(t *testing.T) {
	root := filepath.Join(t.TempDir(), "root")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 46, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	identity := &InventoryNativeIdentity{
		Key:    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		Strong: false, LinkCount: 2, RenameCandidate: false,
	}
	base := InventoryItem{Path: "photo.jpg", Kind: "file", Size: 7, NativeIdentity: identity}
	if _, err := CandidateFromInventoryItem(grant, base); err != nil {
		t.Fatal(err)
	}
	badPath := base
	badPath.Path = "../escape"
	if _, err := CandidateFromInventoryItem(grant, badPath); err == nil {
		t.Fatal("unsafe traversal candidate accepted")
	}
	badLink := base
	copyIdentity := *identity
	copyIdentity.RenameCandidate = true
	badLink.NativeIdentity = &copyIdentity
	if _, err := CandidateFromInventoryItem(grant, badLink); err == nil {
		t.Fatal("weak or multiply-linked file incorrectly marked rename-safe")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = StreamInventoryCandidates(ctx, filepath.Join(t.TempDir(), "config"), grant, 2,
		func([]InventoryCandidate) error { return nil })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled inventory projection continued: %v", err)
	}
}
