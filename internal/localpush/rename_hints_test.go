//go:build linux || windows

package localpush

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeRenameHintRequiresUniqueStrongSingleLinkFile(t *testing.T) {
	key := strings.Repeat("a", 64)
	before := inventoryRenameRecord{Side: "before", Path: "old.txt", Kind: "file",
		NativeIdentityKey: key, StrongNativeIdentity: true, RenameHintSafe: true, LinkCount: 1}
	after := inventoryRenameRecord{Side: "after", Path: "new.txt", Kind: "file",
		NativeIdentityKey: key, StrongNativeIdentity: true, RenameHintSafe: true, LinkCount: 1}
	okPair := inventoryRenameGroup{Before: before, After: after, BeforeCount: 1, AfterCount: 1}
	hint, ok := inventoryRenameHintFor(okPair)
	if !ok || hint.PreviousPath != "old.txt" || hint.CurrentPath != "new.txt" ||
		hint.NativeIdentityKey != key {
		t.Fatalf("valid advisory file rename not found: %+v valid=%v", hint, ok)
	}
	for _, test := range []struct {
		name string
		edit func(*inventoryRenameGroup)
	}{
		{"unchanged path", func(p *inventoryRenameGroup) { p.After.Path = p.Before.Path }},
		{"ignored previous path", func(p *inventoryRenameGroup) { p.Before.Ignored = true }},
		{"ignored current path", func(p *inventoryRenameGroup) { p.After.Ignored = true }},
		{"old hard links", func(p *inventoryRenameGroup) { p.Before.LinkCount = 2 }},
		{"new hard links", func(p *inventoryRenameGroup) { p.After.LinkCount = 2 }},
		{"weak old identity", func(p *inventoryRenameGroup) { p.Before.StrongNativeIdentity = false }},
		{"weak new identity", func(p *inventoryRenameGroup) { p.After.StrongNativeIdentity = false }},
		{"unsafe old hint", func(p *inventoryRenameGroup) { p.Before.RenameHintSafe = false }},
		{"unsafe new hint", func(p *inventoryRenameGroup) { p.After.RenameHintSafe = false }},
		{"ambiguous old identity", func(p *inventoryRenameGroup) { p.BeforeCount = 2 }},
		{"ambiguous new identity", func(p *inventoryRenameGroup) { p.AfterCount = 2 }},
		{"directory not yet supported", func(p *inventoryRenameGroup) {
			p.Before.Kind, p.After.Kind = "directory", "directory"
		}},
		{"kind changed", func(p *inventoryRenameGroup) { p.After.Kind = "directory" }},
		{"different native identity", func(p *inventoryRenameGroup) {
			p.After.NativeIdentityKey = strings.Repeat("b", 64)
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			group := okPair
			test.edit(&group)
			if hint, matched := inventoryRenameHintFor(group); matched {
				t.Fatalf("unsafe identity matched: %+v", hint)
			}
		})
	}
}

func TestNativeRenameHintsFromVerifiedGenerationsRemainAdvisory(t *testing.T) {
	root, grant, config := deltaFixture(t)
	if err := os.WriteFile(filepath.Join(root, "before.txt"), []byte("same object"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	if err := os.Rename(filepath.Join(root, "before.txt"), filepath.Join(root, "after.txt")); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	var hints []InventoryRenameHint
	summary, err := StreamInventoryNativeRenameHints(context.Background(), config, grant, 1,
		func(batch []InventoryRenameHint) error {
			if len(batch) != 1 {
				t.Fatalf("unbounded advisory callback: %d", len(batch))
			}
			hints = append(hints, batch...)
			return nil
		})
	if err != nil || summary.MissingInferenceSafe ||
		summary.Delta.MissingInferenceSafe ||
		summary.Delta.Added != 1 || summary.Delta.AbsentCandidates != 1 ||
		int64(len(hints)) != summary.Hints || len(hints) > 1 {
		t.Fatalf("unexpected read-only native hints: %+v hints=%+v err=%v", summary, hints, err)
	}
	// Systems lacking strong native identity must conservatively return zero
	// hints. The unit test proves the positive unique-identity case separately.
	if len(hints) == 1 && (hints[0].PreviousPath != "before.txt" ||
		hints[0].CurrentPath != "after.txt") {
		t.Fatalf("wrong private path pair: %+v", hints)
	}
}

func TestNativeRenameHintsMissingOrCancelledNeverEmit(t *testing.T) {
	root, grant, config := deltaFixture(t)
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("first"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	calls := 0
	yield := func([]InventoryRenameHint) error { calls++; return nil }
	if _, err := StreamInventoryNativeRenameHints(context.Background(), config, grant, 1, yield); err == nil || calls != 0 {
		t.Fatalf("missing predecessor produced hints: %v calls=%d", err, calls)
	}
	if err := os.WriteFile(filepath.Join(root, "b.txt"), []byte("second"), 0o600); err != nil {
		t.Fatal(err)
	}
	deltaScan(t, config, grant)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := StreamInventoryNativeRenameHints(ctx, config, grant, 1, yield); !errors.Is(err, context.Canceled) || calls != 0 {
		t.Fatalf("cancelled operation produced hints: %v calls=%d", err, calls)
	}
	if _, err := StreamInventoryNativeRenameHints(context.Background(), config, grant, 501, yield); err == nil {
		t.Fatal("unbounded rename-hint batch accepted")
	}
	if _, err := StreamInventoryNativeRenameHints(context.Background(), config, grant, 1, nil); err == nil {
		t.Fatal("nil hint callback accepted")
	}
	if err := os.Rename(root, root+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := StreamInventoryNativeRenameHints(context.Background(), config, grant, 1, yield); err == nil || calls != 0 {
		t.Fatalf("Root replacement was accepted: %v calls=%d", err, calls)
	}
}

func TestNativeRenameBucketCapsPrivateStaging(t *testing.T) {
	dir := t.TempDir()
	key := strings.Repeat("e", 64)
	index := inventoryRenameBucket(key)
	file, err := os.OpenFile(inventoryRenameSpoolPath(dir, index), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	encoder := json.NewEncoder(file)
	for i := 0; i <= inventoryRenameBucketLimit; i++ {
		row := inventoryRenameRecord{Side: "before", Path: fmt.Sprintf("path-%d", i),
			Kind: "file", NativeIdentityKey: key, LinkCount: 2}
		if err := encoder.Encode(row); err != nil {
			t.Fatal(err)
		}
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := readInventoryRenameBucket(dir, index); err == nil {
		t.Fatal("over-limit private identity bucket was accepted")
	}
}

func TestNativeRenameBucketRejectsInvalidSideAndPath(t *testing.T) {
	dir := t.TempDir()
	key := strings.Repeat("f", 64)
	index := inventoryRenameBucket(key)
	for _, row := range []inventoryRenameRecord{
		{Side: "web", Path: "file.txt", Kind: "file", NativeIdentityKey: key, LinkCount: 1},
		{Side: "after", Path: "../secrets", Kind: "file", NativeIdentityKey: key, LinkCount: 1},
	} {
		file, err := os.OpenFile(inventoryRenameSpoolPath(dir, index), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.NewEncoder(file).Encode(row); err != nil {
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
		if _, err := readInventoryRenameBucket(dir, index); err == nil {
			t.Fatalf("invalid private staging row accepted: %+v", row)
		}
	}
}
