//go:build windows

package mount

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestWindowsBaselineStateRoundTripAndPolicyFilter(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "state", "baseline.json")
	now := time.Now().UTC().Round(time.Millisecond)
	rootID := uint64(1)
	parentID := rootID
	baseline := map[string]winState{
		"": {
			node: client.Node{ID: rootID, Name: "", Type: "dir", Revision: 1},
		},
		"keep.txt": {
			node: client.Node{
				ID: 2, ParentID: &parentID, Name: "keep.txt", Type: "file",
				Size: 4, Revision: 3, UpdatedAt: now,
			},
			localModTime: now,
			localSize:    4,
		},
		"excluded/file.txt": {
			node: client.Node{
				ID: 3, ParentID: &parentID, Name: "file.txt", Type: "file",
				Size: 7, Revision: 5, UpdatedAt: now,
			},
			localModTime: now,
			localSize:    7,
		},
	}

	writer := &winProvider{statePath: statePath, policy: newSyncPolicy(Options{})}
	if err := writer.persistBaseline(baseline); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() == 0 {
		t.Fatal("persisted Windows baseline is empty")
	}

	reader := &winProvider{
		statePath: statePath,
		policy: newSyncPolicy(Options{
			ExcludedPaths: []string{"excluded"},
		}),
	}
	loaded, ok, err := reader.loadPersistedBaseline()
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("persisted Windows baseline was not detected")
	}
	if _, exists := loaded["excluded/file.txt"]; exists {
		t.Fatal("excluded path survived baseline load policy filtering")
	}
	keep, exists := loaded["keep.txt"]
	if !exists {
		t.Fatalf("keep.txt missing from loaded baseline: %+v", loaded)
	}
	if keep.node.ID != 2 || keep.node.Revision != 3 || keep.localSize != 4 ||
		!keep.localModTime.Equal(now) {
		t.Fatalf("loaded baseline mismatch: %+v", keep)
	}
	if root, exists := loaded[""]; !exists || root.node.ID != rootID {
		t.Fatalf("loaded baseline root=%+v exists=%t", root, exists)
	}
}

func TestWindowsBaselineStateRejectsCorruption(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "baseline.json")
	if err := os.WriteFile(statePath, []byte("{broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	p := &winProvider{statePath: statePath, policy: newSyncPolicy(Options{})}
	if _, ok, err := p.loadPersistedBaseline(); err == nil || ok {
		t.Fatalf("corrupt baseline load ok=%t err=%v", ok, err)
	}
}

func TestWindowsBaselineStateMigratesLegacyJSON(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "state", "baseline.json")
	if err := os.MkdirAll(filepath.Dir(statePath), 0o700); err != nil {
		t.Fatal(err)
	}
	rootID := uint64(1)
	parentID := rootID
	legacy := winBaselineStateFile{
		Version: winBaselineLegacyStateVersion,
		Entries: map[string]winBaselineEntry{
			"": {Node: client.Node{ID: rootID, Type: "dir", Revision: 1}},
			"legacy.txt": {
				Node:      client.Node{ID: 2, ParentID: &parentID, Name: "legacy.txt", Type: "file", Revision: 1, Size: 6},
				LocalSize: 6,
			},
		},
	}
	data, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statePath, data, 0o600); err != nil {
		t.Fatal(err)
	}

	p := &winProvider{statePath: statePath, policy: newSyncPolicy(Options{})}
	loaded, ok, err := p.loadPersistedBaseline()
	if err != nil {
		t.Fatal(err)
	}
	if !ok || loaded["legacy.txt"].node.ID != 2 {
		t.Fatalf("loaded=%+v ok=%t", loaded, ok)
	}
	migrated, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(migrated, []byte(winBaselineStateMagic)) {
		t.Fatal("legacy baseline was not migrated to V2 state log")
	}
}

func TestWindowsBaselineDeltaAppendsAndReloads(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "state", "baseline.json")
	rootID := uint64(1)
	parentID := rootID
	baseline := map[string]winState{
		"": {node: client.Node{ID: rootID, Type: "dir", Revision: 1}},
	}
	for i := 0; i < 100; i++ {
		name := filepath.ToSlash(filepath.Join("files", fmt.Sprintf("item-%03d.txt", i)))
		baseline[name] = winState{
			node: client.Node{
				ID: uint64(i + 2), ParentID: &parentID, Name: filepath.Base(name),
				Type: "file", Size: 10, Revision: 1,
			},
			localSize: 10,
		}
	}
	p := &winProvider{statePath: statePath, policy: newSyncPolicy(Options{})}
	if err := p.persistBaseline(baseline); err != nil {
		t.Fatal(err)
	}
	beforeInfo, err := os.Stat(statePath)
	if err != nil {
		t.Fatal(err)
	}

	changed := cloneBaseline(baseline)
	entry := changed["files/item-050.txt"]
	entry.node.Revision = 2
	changed["files/item-050.txt"] = entry
	delete(changed, "files/item-051.txt")
	if err := p.persistBaselineDelta(baseline, changed); err != nil {
		t.Fatal(err)
	}
	afterInfo, err := os.Stat(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if afterInfo.Size() <= beforeInfo.Size() {
		t.Fatalf("state log did not append: before=%d after=%d", beforeInfo.Size(), afterInfo.Size())
	}
	if growth := afterInfo.Size() - beforeInfo.Size(); growth >= beforeInfo.Size()/2 {
		t.Fatalf("single-entry delta grew too much: growth=%d snapshot=%d", growth, beforeInfo.Size())
	}

	reader := &winProvider{statePath: statePath, policy: newSyncPolicy(Options{})}
	loaded, ok, err := reader.loadPersistedBaseline()
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("incremental baseline was not detected")
	}
	if loaded["files/item-050.txt"].node.Revision != 2 {
		t.Fatalf("updated revision=%d", loaded["files/item-050.txt"].node.Revision)
	}
	if _, exists := loaded["files/item-051.txt"]; exists {
		t.Fatal("deleted baseline entry survived delta replay")
	}
}

func TestWindowsBaselineStateTruncatesPartialTail(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "state", "baseline.json")
	baseline := map[string]winState{
		"": {node: client.Node{ID: 1, Type: "dir", Revision: 1}},
	}
	writer := &winProvider{statePath: statePath, policy: newSyncPolicy(Options{})}
	if err := writer.persistBaseline(baseline); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(statePath)
	if err != nil {
		t.Fatal(err)
	}
	validSize := info.Size()

	f, err := os.OpenFile(statePath, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte{100, 0, 0, 0, '{', '"', 'x'}); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	reader := &winProvider{statePath: statePath, policy: newSyncPolicy(Options{})}
	loaded, ok, err := reader.loadPersistedBaseline()
	if err != nil {
		t.Fatal(err)
	}
	if !ok || loaded[""].node.ID != 1 {
		t.Fatalf("loaded=%+v ok=%t", loaded, ok)
	}
	info, err = os.Stat(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() != validSize {
		t.Fatalf("partial tail was not truncated: size=%d want=%d", info.Size(), validSize)
	}
}
