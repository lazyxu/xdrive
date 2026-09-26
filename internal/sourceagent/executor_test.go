package sourceagent

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

type fakeExecutionAPI struct {
	nextID     uint64
	children   map[uint64][]client.Node
	nodeTypes  map[uint64]string
	createDirs int
	uploads    int
	overwrites int
	moves      int
	upload     client.UploadResult
	overwrite  client.UploadResult
}

func newFakeExecutionAPI() *fakeExecutionAPI {
	return &fakeExecutionAPI{
		nextID:    1000,
		children:  map[uint64][]client.Node{},
		nodeTypes: map[uint64]string{},
	}
}

func (f *fakeExecutionAPI) List(_ context.Context, parentID uint64) ([]client.Node, error) {
	return append([]client.Node(nil), f.children[parentID]...), nil
}

func (f *fakeExecutionAPI) CreateDir(_ context.Context, parentID uint64, name string) (client.Node, error) {
	f.createDirs++
	f.nextID++
	parent := parentID
	node := client.Node{ID: f.nextID, ParentID: &parent, Name: name, Type: meta.NodeTypeDir, Revision: 1}
	f.children[parentID] = append(f.children[parentID], node)
	f.nodeTypes[node.ID] = node.Type
	return node, nil
}

func (f *fakeExecutionAPI) RenameMove(_ context.Context, id, revision uint64, name *string, parentID *uint64) (client.Node, error) {
	f.moves++
	parent := *parentID
	node := client.Node{
		ID: id, ParentID: &parent, Name: *name,
		Type: f.nodeTypes[id], Revision: revision + 1,
	}
	f.children[parent] = append(f.children[parent], node)
	return node, nil
}

func (f *fakeExecutionAPI) UploadFileResumableResult(_ context.Context, parentID uint64, _ string, name string, _ client.UploadProgress) (client.UploadResult, error) {
	f.uploads++
	result := f.upload
	if result.Node.ID == 0 {
		f.nextID++
		result.Node = client.Node{ID: f.nextID, Name: name, Type: meta.NodeTypeFile, Revision: 1}
	}
	parent := parentID
	result.Node.ParentID = &parent
	result.Node.Name = name
	result.Node.Type = meta.NodeTypeFile
	f.nodeTypes[result.Node.ID] = meta.NodeTypeFile
	f.children[parentID] = append(f.children[parentID], result.Node)
	return result, nil
}

func (f *fakeExecutionAPI) OverwriteFileResumableResult(_ context.Context, nodeID, revision uint64, _ string, _ client.UploadProgress) (client.UploadResult, error) {
	f.overwrites++
	result := f.overwrite
	if result.Node.ID == 0 {
		result.Node = client.Node{ID: nodeID, Type: meta.NodeTypeFile, Revision: revision + 1}
	}
	f.nodeTypes[nodeID] = meta.NodeTypeFile
	return result, nil
}

func TestExecutorCreatesParentsAndReportsAcceptedTransferBytes(t *testing.T) {
	local := filepath.Join(t.TempDir(), "a.jpg")
	if err := os.WriteFile(local, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(local)
	if err != nil {
		t.Fatal(err)
	}
	modified := info.ModTime().UTC()

	api := newFakeExecutionAPI()
	api.upload = client.UploadResult{
		Node:             client.Node{ID: 2000, Type: meta.NodeTypeFile, Revision: 1},
		SHA256:           "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		TransferredBytes: 3,
	}
	executor := NewExecutor(api, 100)
	commit, err := executor.Execute(context.Background(), client.SourcePlan{
		ExternalID: "file-1", Action: string(sourcepkg.ActionCreate),
	}, sourcepkg.DiscoveredItem{
		ExternalID: "file-1", Kind: meta.SourceItemKindFile,
		Path: "Personal/Trip/a.jpg", Size: 3, ModifiedAt: &modified,
	}, local)
	if err != nil {
		t.Fatal(err)
	}
	if api.createDirs != 2 || api.uploads != 1 {
		t.Fatalf("createDirs=%d uploads=%d", api.createDirs, api.uploads)
	}
	if commit.NodeID != 2000 || commit.NodeRevision != 1 ||
		commit.SHA256 != api.upload.SHA256 || !commit.Transferred || commit.TransferredBytes != 3 {
		t.Fatalf("unexpected commit: %+v", commit)
	}
}

func TestExecutorPureMoveDoesNotUpload(t *testing.T) {
	local := filepath.Join(t.TempDir(), "photo.jpg")
	if err := os.WriteFile(local, []byte("photo"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(local)
	if err != nil {
		t.Fatal(err)
	}
	modified := info.ModTime().UTC()

	api := newFakeExecutionAPI()
	target := uint64(100)
	shared := client.Node{ID: 110, ParentID: &target, Name: "Shared", Type: meta.NodeTypeDir, Revision: 1}
	newParent := client.Node{ID: 111, ParentID: &shared.ID, Name: "New", Type: meta.NodeTypeDir, Revision: 1}
	api.children[target] = []client.Node{shared}
	api.children[shared.ID] = []client.Node{newParent}
	api.nodeTypes[300] = meta.NodeTypeFile

	executor := NewExecutor(api, target)
	nodeID := uint64(300)
	commit, err := executor.Execute(context.Background(), client.SourcePlan{
		ExternalID: "file-2", Action: string(sourcepkg.ActionMove),
		NodeID: &nodeID, NodeRevision: 4,
	}, sourcepkg.DiscoveredItem{
		ExternalID: "file-2", Kind: meta.SourceItemKindFile,
		Path: "Shared/New/photo.jpg", Size: int64(info.Size()), ModifiedAt: &modified,
	}, local)
	if err != nil {
		t.Fatal(err)
	}
	if api.moves != 1 || api.uploads != 0 || api.overwrites != 0 {
		t.Fatalf("moves=%d uploads=%d overwrites=%d", api.moves, api.uploads, api.overwrites)
	}
	if commit.NodeID != nodeID || commit.NodeRevision != 5 || commit.Transferred || commit.TransferredBytes != 0 {
		t.Fatalf("unexpected move commit: %+v", commit)
	}
}

func TestExecutorRejectsFileChangedAfterScan(t *testing.T) {
	local := filepath.Join(t.TempDir(), "changed.jpg")
	if err := os.WriteFile(local, []byte("new-content"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(local)
	if err != nil {
		t.Fatal(err)
	}
	modified := info.ModTime().UTC()

	api := newFakeExecutionAPI()
	executor := NewExecutor(api, 100)
	_, err = executor.Execute(context.Background(), client.SourcePlan{
		ExternalID: "file-3", Action: string(sourcepkg.ActionCreate),
	}, sourcepkg.DiscoveredItem{
		ExternalID: "file-3", Kind: meta.SourceItemKindFile,
		Path: "Personal/changed.jpg", Size: int64(info.Size()) - 1, ModifiedAt: &modified,
	}, local)
	if err == nil {
		t.Fatal("changed source file was executed")
	}
	if api.createDirs != 0 || api.uploads != 0 || api.overwrites != 0 || api.moves != 0 {
		t.Fatalf("executor mutated remote state after stale scan: %+v", api)
	}
}
