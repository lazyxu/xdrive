//go:build windows

package mount

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestWindowsRemoteJournalSamePathFileUpsertSnapshotIsBounded(t *testing.T) {
	const ordinaryFiles = 100000
	rootID := uint64(1)
	baseline := make(map[string]winState, ordinaryFiles+1)
	baseline[""] = winState{node: client.Node{ID: rootID, Type: "dir", Revision: 1}}
	for index := 0; index < ordinaryFiles-1; index++ {
		parent := rootID
		rel := fmt.Sprintf("ordinary-%06d.bin", index)
		baseline[rel] = winState{node: client.Node{
			ID:       uint64(index + 10),
			ParentID: &parent,
			Name:     rel,
			Type:     "file",
			Revision: 1,
		}}
	}
	targetID := uint64(ordinaryFiles + 100)
	parent := rootID
	target := "target.bin"
	baseline[target] = winState{node: client.Node{
		ID:       targetID,
		ParentID: &parent,
		Name:     target,
		Type:     "file",
		Revision: 7,
	}}
	hydratedAt := time.Now()
	p := &winProvider{
		baseline: baseline,
		hydrated: map[uint64]time.Time{targetID: hydratedAt},
	}
	next := baseline[target].node
	next.Revision = 8

	snapshots, ok := p.snapshotRemoteFileUpserts([]client.NodeChange{{
		NodeID:    targetID,
		Operation: "upsert",
		Path:      target,
		Node:      &next,
	}})
	if !ok {
		t.Fatal("same-path file upsert did not qualify for bounded snapshot")
	}
	if len(snapshots) != 1 {
		t.Fatalf("snapshot count=%d want=1", len(snapshots))
	}
	if snapshots[0].rel != target ||
		snapshots[0].base.node.ID != targetID ||
		snapshots[0].node.Revision != 8 ||
		!snapshots[0].hydratedAt.Equal(hydratedAt) {
		t.Fatalf("snapshot=%+v", snapshots[0])
	}
	if len(p.baseline) != ordinaryFiles+1 {
		t.Fatalf("baseline size changed=%d", len(p.baseline))
	}
	next.ParentID = nil
	if snapshots, ok := p.snapshotRemoteFileUpserts([]client.NodeChange{{
		NodeID:    targetID,
		Operation: "upsert",
		Path:      target,
		Node:      &next,
	}}); ok || snapshots != nil {
		t.Fatal("parent-identity change must fall back to the full journal path")
	}
}

func TestWindowsRemoteJournalFastPathPrecedesBaselineClone(t *testing.T) {
	sourceBytes, err := os.ReadFile("reconcile_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	start := strings.Index(source, "func (p *winProvider) applyRemoteChangePage")
	if start < 0 {
		t.Fatal("applyRemoteChangePage not found")
	}
	rest := source[start:]
	end := strings.Index(rest, "\nfunc ")
	if end < 0 {
		t.Fatal("applyRemoteChangePage end not found")
	}
	block := rest[:end]
	fast := strings.Index(block, "p.applyRemoteFileUpsertPageFast(changes)")
	clone := strings.Index(block, "baseline := cloneBaseline(p.baseline)")
	if fast < 0 || clone < 0 || fast >= clone {
		t.Fatalf("same-path fast path must run before full baseline clone: fast=%d clone=%d", fast, clone)
	}

	snapshotStart := strings.Index(source, "func (p *winProvider) snapshotRemoteFileUpserts")
	if snapshotStart < 0 {
		t.Fatal("snapshotRemoteFileUpserts not found")
	}
	snapshotRest := source[snapshotStart:]
	snapshotEnd := strings.Index(snapshotRest, "\nfunc ")
	if snapshotEnd < 0 {
		t.Fatal("snapshotRemoteFileUpserts end not found")
	}
	snapshotBlock := snapshotRest[:snapshotEnd]
	for _, forbidden := range []string{
		"cloneBaseline(",
		"cloneHydrated(",
		"range p.baseline",
		"range p.hydrated",
	} {
		if strings.Contains(snapshotBlock, forbidden) {
			t.Fatalf("bounded same-path snapshot must not scan/copy global state: found %q", forbidden)
		}
	}
	for _, required := range []string{
		"p.baseline[rel]",
		"p.baseline[slashDir(rel)]",
		"p.hydrated[base.node.ID]",
	} {
		if !strings.Contains(snapshotBlock, required) {
			t.Fatalf("bounded snapshot missing exact lookup %q", required)
		}
	}
}

func TestWindowsRemoteJournalPathUpdatePersistsWithoutFullCurrentMap(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "baseline.state")
	rootID := uint64(1)
	parent := rootID
	fileID := uint64(2)
	before := winState{node: client.Node{
		ID:       fileID,
		ParentID: &parent,
		Name:     "a.bin",
		Type:     "file",
		Revision: 1,
	}}
	p := &winProvider{
		baseline: map[string]winState{
			"":      {node: client.Node{ID: rootID, Type: "dir", Revision: 1}},
			"a.bin": before,
		},
		hydrated:  map[uint64]time.Time{},
		statePath: statePath,
	}
	if err := p.persistBaseline(p.baseline); err != nil {
		t.Fatal(err)
	}

	after := before
	after.node.Revision = 2
	after.localSize = 42
	p.storeBaselinePathUpdates(map[string]winState{"a.bin": after})

	loaded, frames, _, err := p.loadBaselineLog()
	if err != nil {
		t.Fatal(err)
	}
	if frames != 2 {
		t.Fatalf("baseline frames=%d want=2", frames)
	}
	got, ok := loaded["a.bin"]
	if !ok {
		t.Fatal("persisted path update missing")
	}
	if got.node.Revision != 2 || got.localSize != 42 {
		t.Fatalf("persisted state=%+v", got)
	}
}
