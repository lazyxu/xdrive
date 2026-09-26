//go:build windows

package mount

import (
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
