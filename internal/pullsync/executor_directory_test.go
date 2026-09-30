package pullsync

import (
	"context"
	"fmt"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

type directoryExecutionAPI struct {
	nextID   uint64
	nodes    map[uint64]client.Node
	children map[uint64][]uint64
}

func newDirectoryExecutionAPI() *directoryExecutionAPI {
	root := client.Node{ID: 1, Name: "target", Type: meta.NodeTypeDir, Revision: 1}
	return &directoryExecutionAPI{
		nextID:   1,
		nodes:    map[uint64]client.Node{1: root},
		children: make(map[uint64][]uint64),
	}
}

func (a *directoryExecutionAPI) List(_ context.Context, parentID uint64) ([]client.Node, error) {
	ids := a.children[parentID]
	out := make([]client.Node, 0, len(ids))
	for _, id := range ids {
		out = append(out, a.nodes[id])
	}
	return out, nil
}

func (a *directoryExecutionAPI) CreateDir(_ context.Context, parentID uint64, name string) (client.Node, error) {
	if _, ok := a.nodes[parentID]; !ok {
		return client.Node{}, fmt.Errorf("parent %d not found", parentID)
	}
	a.nextID++
	parent := parentID
	node := client.Node{ID: a.nextID, ParentID: &parent, Name: name, Type: meta.NodeTypeDir, Revision: 1}
	a.nodes[node.ID] = node
	a.children[parentID] = append(a.children[parentID], node.ID)
	return node, nil
}

func (a *directoryExecutionAPI) RenameMove(
	_ context.Context,
	nodeID uint64,
	revision uint64,
	name *string,
	parentID *uint64,
) (client.Node, error) {
	node, ok := a.nodes[nodeID]
	if !ok || node.Revision != revision {
		return client.Node{}, fmt.Errorf("node revision conflict")
	}
	if node.ParentID != nil {
		oldParent := *node.ParentID
		ids := a.children[oldParent]
		out := ids[:0]
		for _, id := range ids {
			if id != nodeID {
				out = append(out, id)
			}
		}
		a.children[oldParent] = out
	}
	if name != nil {
		node.Name = *name
	}
	if parentID != nil {
		parent := *parentID
		node.ParentID = &parent
		a.children[parent] = append(a.children[parent], nodeID)
	}
	node.Revision++
	a.nodes[nodeID] = node
	return node, nil
}

func (a *directoryExecutionAPI) UploadStreamResumableDigestResult(
	context.Context,
	uint64,
	string,
	int64,
	string,
	string,
	client.UploadStreamOpen,
	client.UploadProgress,
) (client.UploadResult, error) {
	return client.UploadResult{}, fmt.Errorf("unexpected file upload")
}

func (a *directoryExecutionAPI) OverwriteStreamResumableDigestResult(
	context.Context,
	uint64,
	uint64,
	int64,
	string,
	string,
	client.UploadStreamOpen,
	client.UploadProgress,
) (client.UploadResult, error) {
	return client.UploadResult{}, fmt.Errorf("unexpected file overwrite")
}

func TestExecutorPreservesEmptyDirectories(t *testing.T) {
	api := newDirectoryExecutionAPI()
	executor := NewExecutor[string](api, 1, "generic", nil, nil)
	item := sourcepkg.DiscoveredItem{
		ExternalID: "dir:empty",
		Kind:       meta.SourceItemKindDirectory,
		Path:       "Documents/Empty",
	}
	commit, err := executor.Execute(context.Background(), client.SourcePlan{
		ExternalID: item.ExternalID,
		Action:     string(sourcepkg.ActionCreate),
	}, item, "")
	if err != nil {
		t.Fatal(err)
	}
	if commit.NodeID == 0 || commit.NodeRevision != 1 || commit.Kind != meta.SourceItemKindDirectory {
		t.Fatalf("unexpected directory commit: %+v", commit)
	}
	node := api.nodes[commit.NodeID]
	if node.Name != "Empty" || node.ParentID == nil || api.nodes[*node.ParentID].Name != "Documents" {
		t.Fatalf("empty directory path was not preserved: %+v", node)
	}
}

func TestExecutorMovesDirectoryAndRefreshesCache(t *testing.T) {
	api := newDirectoryExecutionAPI()
	executor := NewExecutor[string](api, 1, "generic", nil, nil)
	item := sourcepkg.DiscoveredItem{
		ExternalID: "dir:move",
		Kind:       meta.SourceItemKindDirectory,
		Path:       "Before/Folder",
	}
	created, err := executor.Execute(context.Background(), client.SourcePlan{
		ExternalID: item.ExternalID,
		Action:     string(sourcepkg.ActionCreate),
	}, item, "")
	if err != nil {
		t.Fatal(err)
	}

	item.Path = "After/Folder"
	moved, err := executor.Execute(context.Background(), client.SourcePlan{
		ExternalID:   item.ExternalID,
		Action:       string(sourcepkg.ActionMove),
		NodeID:       &created.NodeID,
		NodeRevision: created.NodeRevision,
	}, item, "")
	if err != nil {
		t.Fatal(err)
	}
	if moved.NodeID != created.NodeID || moved.NodeRevision != created.NodeRevision+1 {
		t.Fatalf("unexpected move commit: created=%+v moved=%+v", created, moved)
	}
	node := api.nodes[moved.NodeID]
	if node.ParentID == nil || api.nodes[*node.ParentID].Name != "After" {
		t.Fatalf("directory was not moved to new parent: %+v", node)
	}
	if cached, ok := executor.dirCache["After/Folder"]; !ok || cached.ID != moved.NodeID {
		t.Fatalf("new directory cache entry missing: %+v", executor.dirCache)
	}
	if _, stale := executor.dirCache["Before/Folder"]; stale {
		t.Fatalf("old directory cache entry was retained: %+v", executor.dirCache)
	}
}

func TestExecutorDirectoryUpdateIsMetadataOnly(t *testing.T) {
	api := newDirectoryExecutionAPI()
	executor := NewExecutor[string](api, 1, "generic", nil, nil)
	nodeID := uint64(9)
	item := sourcepkg.DiscoveredItem{
		ExternalID: "dir:update",
		Kind:       meta.SourceItemKindDirectory,
		Path:       "Folder",
	}
	commit, err := executor.Execute(context.Background(), client.SourcePlan{
		ExternalID:   item.ExternalID,
		Action:       string(sourcepkg.ActionUpdate),
		NodeID:       &nodeID,
		NodeRevision: 7,
	}, item, "")
	if err != nil {
		t.Fatal(err)
	}
	if commit.NodeID != nodeID || commit.NodeRevision != 7 {
		t.Fatalf("directory metadata update changed node identity: %+v", commit)
	}
}

func TestExecutorFileStillRequiresStreamOpener(t *testing.T) {
	api := newDirectoryExecutionAPI()
	executor := NewExecutor[string](api, 1, "generic", nil, nil)
	item := sourcepkg.DiscoveredItem{
		ExternalID: "file:text",
		Kind:       meta.SourceItemKindFile,
		Path:       "notes.txt",
		Size:       4,
	}
	_, err := executor.Execute(context.Background(), client.SourcePlan{
		ExternalID: item.ExternalID,
		Action:     string(sourcepkg.ActionCreate),
	}, item, "")
	if err == nil {
		t.Fatal("file execution without stream opener succeeded")
	}
}

var _ ExecutionAPI = (*directoryExecutionAPI)(nil)
