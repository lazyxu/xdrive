//go:build windows

package mount

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestWindowsRemoteJournalSamePathFileDeleteSnapshotIsBounded(t *testing.T) {
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
		policy:   newSyncPolicy(Options{}),
	}

	snapshots, ok := p.snapshotRemoteFileDeletes([]client.NodeChange{{
		NodeID: targetID, Operation: "delete", Path: target,
	}})
	if !ok {
		t.Fatal("same-path file delete did not qualify for bounded snapshot")
	}
	if len(snapshots) != 1 {
		t.Fatalf("snapshot count=%d want=1", len(snapshots))
	}
	if snapshots[0].rel != target ||
		snapshots[0].base.node.ID != targetID ||
		!snapshots[0].hydratedAt.Equal(hydratedAt) {
		t.Fatalf("snapshot=%+v", snapshots[0])
	}
	if len(p.baseline) != ordinaryFiles+1 {
		t.Fatalf("baseline size changed=%d", len(p.baseline))
	}
	if snapshots, ok := p.snapshotRemoteFileDeletes([]client.NodeChange{{
		NodeID: targetID, Operation: "delete",
	}}); ok || snapshots != nil {
		t.Fatal("delete without a Server-resolved path must keep the full journal path")
	}
}

func TestWindowsRemoteJournalFileDeleteFastPathPrecedesBaselineClone(t *testing.T) {
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
	if !strings.Contains(source, "p.cli.NodeChangesWithDeletedPaths(ctx, cursor, pageLimit)") {
		t.Fatal("Windows remote journal must request deleted paths from the Server")
	}
	fast := strings.Index(block, "p.applyRemoteFileDeletePageFast(changes)")
	clone := strings.Index(block, "baseline := cloneBaseline(p.baseline)")
	if fast < 0 || clone < 0 || fast >= clone {
		t.Fatalf("file-delete fast path must run before full baseline clone: fast=%d clone=%d", fast, clone)
	}

	snapshotStart := strings.Index(source, "func (p *winProvider) snapshotRemoteFileDeletes")
	if snapshotStart < 0 {
		t.Fatal("snapshotRemoteFileDeletes not found")
	}
	snapshotRest := source[snapshotStart:]
	snapshotEnd := strings.Index(snapshotRest, "\nfunc ")
	if snapshotEnd < 0 {
		t.Fatal("snapshotRemoteFileDeletes end not found")
	}
	snapshotBlock := snapshotRest[:snapshotEnd]
	for _, forbidden := range []string{
		"cloneBaseline(",
		"cloneHydrated(",
		"range p.baseline",
		"range p.hydrated",
	} {
		if strings.Contains(snapshotBlock, forbidden) {
			t.Fatalf("bounded file-delete snapshot must not scan/copy global state: found %q", forbidden)
		}
	}
	for _, required := range []string{
		"p.baseline[rel]",
		"p.baseline[slashDir(rel)]",
		"p.hydrated[base.node.ID]",
	} {
		if !strings.Contains(snapshotBlock, required) {
			t.Fatalf("bounded file-delete snapshot missing exact lookup %q", required)
		}
	}
}

func TestWindowsRemoteJournalFileDeleteFastPathPreservesLocalConflict(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "target.bin")
	if err := os.WriteFile(path, []byte("local-newer"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	rootID := uint64(1)
	fileID := uint64(2)
	parent := rootID
	p := &winProvider{
		root: root,
		baseline: map[string]winState{
			"": {node: client.Node{ID: rootID, Type: "dir", Revision: 1}},
			"target.bin": {
				node: client.Node{
					ID: fileID, ParentID: &parent, Name: "target.bin", Type: "file", Revision: 1,
				},
				localModTime: info.ModTime().Add(-time.Minute),
				localSize:    1,
			},
		},
		hydrated: map[uint64]time.Time{},
		accessed: map[uint64]time.Time{},
		policy:   newSyncPolicy(Options{}),
	}
	_, err = p.applyRemoteChangePage(context.Background(), []client.NodeChange{{
		NodeID: fileID, Operation: "delete", Path: "target.bin",
	}})
	if err == nil || !strings.Contains(err.Error(), "remote deletion conflicts with unsynchronized local changes") {
		t.Fatalf("delete conflict err=%v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("conflicting local file was removed: %v", err)
	}
	if _, exists := p.baseline["target.bin"]; !exists {
		t.Fatal("conflicting delete removed baseline entry")
	}
}

func TestWindowsRemoteJournalFileDeletePathDeltaPersistsWithoutFullCurrentMap(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "baseline.state")
	rootID := uint64(1)
	fileID := uint64(2)
	parent := rootID
	p := &winProvider{
		baseline: map[string]winState{
			"": {node: client.Node{ID: rootID, Type: "dir", Revision: 1}},
			"a.bin": {node: client.Node{
				ID: fileID, ParentID: &parent, Name: "a.bin", Type: "file", Revision: 1,
			}},
		},
		hydrated:  map[uint64]time.Time{},
		statePath: statePath,
	}
	if err := p.persistBaseline(p.baseline); err != nil {
		t.Fatal(err)
	}
	p.storeBaselinePathDeletes([]winRemoteFileDeleteSnapshot{{
		rel:  "a.bin",
		base: p.baseline["a.bin"],
	}})

	loaded, frames, _, err := p.loadBaselineLog()
	if err != nil {
		t.Fatal(err)
	}
	if frames != 2 {
		t.Fatalf("baseline frames=%d want=2", frames)
	}
	if _, exists := loaded["a.bin"]; exists {
		t.Fatal("persisted delete path still exists")
	}
}
