package synologysync

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/synology"
)

type fakeDownloadRemote struct {
	data        []byte
	openOffsets []int64
}

func (f *fakeDownloadRemote) OpenItem(_ context.Context, _ synology.Item, offset int64) (io.ReadCloser, error) {
	f.openOffsets = append(f.openOffsets, offset)
	return io.NopCloser(strings.NewReader(string(f.data[offset:]))), nil
}

type fakeExecutionAPI struct {
	nextID     uint64
	children   map[uint64][]client.Node
	uploads    int
	overwrites int
	moves      int
	createDirs int
	lastMD5    string
}

func newFakeExecutionAPI() *fakeExecutionAPI {
	return &fakeExecutionAPI{nextID: 1000, children: map[uint64][]client.Node{}}
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
	return node, nil
}

func (f *fakeExecutionAPI) RenameMove(_ context.Context, id, revision uint64, name *string, parentID *uint64) (client.Node, error) {
	f.moves++
	parent := *parentID
	node := client.Node{ID: id, ParentID: &parent, Name: *name, Type: meta.NodeTypeFile, Revision: revision + 1}
	f.children[parent] = append(f.children[parent], node)
	return node, nil
}

func (f *fakeExecutionAPI) UploadStreamResumableDigestResult(
	ctx context.Context,
	parentID uint64,
	name string,
	size int64,
	md5 string,
	_ string,
	open client.UploadStreamOpen,
	_ client.UploadProgress,
) (client.UploadResult, error) {
	f.uploads++
	f.lastMD5 = md5
	body, err := open(ctx, 0)
	if err != nil {
		return client.UploadResult{}, err
	}
	defer body.Close()
	data, err := io.ReadAll(body)
	if err != nil {
		return client.UploadResult{}, err
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	f.nextID++
	parent := parentID
	node := client.Node{
		ID: f.nextID, ParentID: &parent, Name: name, Type: meta.NodeTypeFile,
		Size: size, Revision: 1, SHA256: hash,
	}
	f.children[parentID] = append(f.children[parentID], node)
	return client.UploadResult{Node: node, SHA256: hash, TransferredBytes: int64(len(data))}, nil
}

func (f *fakeExecutionAPI) OverwriteStreamResumableDigestResult(
	ctx context.Context,
	nodeID, revision uint64,
	size int64,
	md5 string,
	_ string,
	open client.UploadStreamOpen,
	_ client.UploadProgress,
) (client.UploadResult, error) {
	f.overwrites++
	f.lastMD5 = md5
	body, err := open(ctx, 0)
	if err != nil {
		return client.UploadResult{}, err
	}
	defer body.Close()
	data, err := io.ReadAll(body)
	if err != nil {
		return client.UploadResult{}, err
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	node := client.Node{ID: nodeID, Type: meta.NodeTypeFile, Size: size, Revision: revision + 1, SHA256: hash}
	return client.UploadResult{Node: node, SHA256: hash, TransferredBytes: int64(len(data))}, nil
}

func TestExecutorStreamsCreateWithoutSourceMD5(t *testing.T) {
	remote := &fakeDownloadRemote{data: []byte("photo-data")}
	api := newFakeExecutionAPI()
	executor := NewExecutor(remote, api, 100)
	item := sourcepkg.DiscoveredItem{
		ExternalID:     "synology:personal:9",
		Kind:           meta.SourceItemKindFile,
		Path:           "Personal/2026/photo.jpg [9]",
		Size:           int64(len(remote.data)),
		RemoteRevision: "cache:9_1:size:10",
	}
	commit, err := executor.Execute(context.Background(), client.SourcePlan{
		ExternalID: item.ExternalID,
		Action:     string(sourcepkg.ActionCreate),
	}, item, TransferRef{Item: synology.Item{ID: 9, Space: synology.SpacePersonal}})
	if err != nil {
		t.Fatal(err)
	}
	if api.uploads != 1 || api.lastMD5 != "" || api.createDirs != 2 {
		t.Fatalf("api=%+v", api)
	}
	if len(remote.openOffsets) != 1 || remote.openOffsets[0] != 0 {
		t.Fatalf("open offsets=%v", remote.openOffsets)
	}
	if !commit.Transferred || commit.TransferredBytes != item.Size || commit.SHA256 == "" {
		t.Fatalf("commit=%+v", commit)
	}
}

func TestExecutorMoveDoesNotDownload(t *testing.T) {
	remote := &fakeDownloadRemote{data: []byte("unused")}
	api := newFakeExecutionAPI()
	target := uint64(100)
	personal := client.Node{ID: 110, ParentID: &target, Name: "Personal", Type: meta.NodeTypeDir, Revision: 1}
	api.children[target] = []client.Node{personal}
	executor := NewExecutor(remote, api, target)
	nodeID := uint64(500)
	item := sourcepkg.DiscoveredItem{
		ExternalID: "synology:personal:1",
		Kind:       meta.SourceItemKindFile,
		Path:       "Personal/renamed.jpg [1]",
		Size:       5,
	}
	commit, err := executor.Execute(context.Background(), client.SourcePlan{
		ExternalID:   item.ExternalID,
		Action:       string(sourcepkg.ActionMove),
		NodeID:       &nodeID,
		NodeRevision: 3,
	}, item, TransferRef{Item: synology.Item{ID: 1, Space: synology.SpacePersonal}})
	if err != nil {
		t.Fatal(err)
	}
	if api.moves != 1 || api.uploads != 0 || api.overwrites != 0 || len(remote.openOffsets) != 0 {
		t.Fatalf("unexpected side effects api=%+v offsets=%v", api, remote.openOffsets)
	}
	if commit.Transferred || commit.NodeID != nodeID || commit.NodeRevision != 4 {
		t.Fatalf("commit=%+v", commit)
	}
}
