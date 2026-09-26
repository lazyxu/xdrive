package yikesync

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
	"github.com/lazyxu/xdrive/internal/yike"
)

type fakeDownloadRemote struct {
	normalLinks int
	albumLinks  int
	openOffsets []int64
	data        []byte
	linkErr     error
}

func (f *fakeDownloadRemote) DownloadFileLink(context.Context, int64) (yike.DownloadLink, error) {
	f.normalLinks++
	if f.linkErr != nil {
		return yike.DownloadLink{}, f.linkErr
	}
	return yike.DownloadLink{URL: "memory://normal"}, nil
}

func (f *fakeDownloadRemote) DownloadAlbumFileLink(context.Context, int64, yike.AlbumFile) (yike.DownloadLink, error) {
	f.albumLinks++
	if f.linkErr != nil {
		return yike.DownloadLink{}, f.linkErr
	}
	return yike.DownloadLink{URL: "memory://album"}, nil
}

func (f *fakeDownloadRemote) OpenDownload(_ context.Context, _ yike.DownloadLink, offset int64) (io.ReadCloser, error) {
	f.openOffsets = append(f.openOffsets, offset)
	return io.NopCloser(strings.NewReader(string(f.data[offset:]))), nil
}

type fakeYikeExecutionAPI struct {
	nextID      uint64
	children    map[uint64][]client.Node
	uploads     int
	overwrites  int
	moves       int
	createDirs  int
	openOffsets []int64
}

func newFakeYikeExecutionAPI() *fakeYikeExecutionAPI {
	return &fakeYikeExecutionAPI{
		nextID:   1000,
		children: map[uint64][]client.Node{},
	}
}

func (f *fakeYikeExecutionAPI) List(_ context.Context, parentID uint64) ([]client.Node, error) {
	return append([]client.Node(nil), f.children[parentID]...), nil
}

func (f *fakeYikeExecutionAPI) CreateDir(_ context.Context, parentID uint64, name string) (client.Node, error) {
	f.createDirs++
	f.nextID++
	parent := parentID
	node := client.Node{ID: f.nextID, ParentID: &parent, Name: name, Type: meta.NodeTypeDir, Revision: 1}
	f.children[parentID] = append(f.children[parentID], node)
	return node, nil
}

func (f *fakeYikeExecutionAPI) RenameMove(_ context.Context, id, revision uint64, name *string, parentID *uint64) (client.Node, error) {
	f.moves++
	parent := *parentID
	node := client.Node{ID: id, ParentID: &parent, Name: *name, Type: meta.NodeTypeFile, Revision: revision + 1}
	f.children[parent] = append(f.children[parent], node)
	return node, nil
}

func (f *fakeYikeExecutionAPI) UploadStreamResumableResult(
	ctx context.Context,
	parentID uint64,
	name string,
	size int64,
	_ string,
	open client.UploadStreamOpen,
	_ client.UploadProgress,
) (client.UploadResult, error) {
	f.uploads++
	body, err := open(ctx, 0)
	if err != nil {
		return client.UploadResult{}, err
	}
	defer body.Close()
	data, err := io.ReadAll(body)
	if err != nil {
		return client.UploadResult{}, err
	}
	if int64(len(data)) != size {
		return client.UploadResult{}, io.ErrUnexpectedEOF
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
	return client.UploadResult{Node: node, SHA256: hash, TransferredBytes: size}, nil
}

func (f *fakeYikeExecutionAPI) OverwriteStreamResumableResult(
	ctx context.Context,
	nodeID, revision uint64,
	size int64,
	_ string,
	open client.UploadStreamOpen,
	_ client.UploadProgress,
) (client.UploadResult, error) {
	f.overwrites++
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

func TestExecutorStreamsSharedCreateAndCommitsHash(t *testing.T) {
	remote := &fakeDownloadRemote{data: []byte("shared-data")}
	api := newFakeYikeExecutionAPI()
	executor := NewExecutor(remote, api, 100)
	modified := yike.File{FSID: 9, Path: "/shared.jpg", Size: int64(len(remote.data)), MTime: 1000}.ModifiedAt()
	item := sourcepkg.DiscoveredItem{
		ExternalID: "yike:999:9", Kind: meta.SourceItemKindFile,
		Path: "Shared/999/shared.jpg [9]", Size: int64(len(remote.data)),
		ModifiedAt: &modified, RemoteRevision: "md5:abcd",
	}
	albumFile := yike.AlbumFile{
		File:    yike.File{FSID: 9, Path: "/shared.jpg", Size: item.Size, MTime: 1000},
		AlbumID: "shared-album", TID: 7, UK: 999,
	}
	commit, err := executor.Execute(context.Background(), client.SourcePlan{
		ExternalID: item.ExternalID, Action: string(sourcepkg.ActionCreate),
	}, item, TransferRef{OwnUK: 123, OwnerUK: 999, File: albumFile.File, AlbumFile: &albumFile})
	if err != nil {
		t.Fatal(err)
	}
	if remote.albumLinks != 1 || remote.normalLinks != 0 || api.uploads != 1 {
		t.Fatalf("albumLinks=%d normalLinks=%d uploads=%d", remote.albumLinks, remote.normalLinks, api.uploads)
	}
	if api.createDirs != 2 {
		t.Fatalf("created dirs=%d want=2", api.createDirs)
	}
	if !commit.Transferred || commit.TransferredBytes != item.Size || commit.SHA256 == "" ||
		commit.NodeID == 0 || commit.NodeRevision == 0 {
		t.Fatalf("unexpected commit: %+v", commit)
	}
}

func TestExecutorMoveDoesNotOpenRemote(t *testing.T) {
	remote := &fakeDownloadRemote{data: []byte("unused")}
	api := newFakeYikeExecutionAPI()
	target := uint64(100)
	library := client.Node{ID: 110, ParentID: &target, Name: "Library", Type: meta.NodeTypeDir, Revision: 1}
	api.children[target] = []client.Node{library}
	executor := NewExecutor(remote, api, target)
	nodeID := uint64(500)
	item := sourcepkg.DiscoveredItem{
		ExternalID: "yike:123:1", Kind: meta.SourceItemKindFile,
		Path: "Library/renamed.jpg [1]", Size: 5,
	}
	commit, err := executor.Execute(context.Background(), client.SourcePlan{
		ExternalID: item.ExternalID, Action: string(sourcepkg.ActionMove),
		NodeID: &nodeID, NodeRevision: 3,
	}, item, TransferRef{OwnUK: 123, OwnerUK: 123, File: yike.File{FSID: 1}})
	if err != nil {
		t.Fatal(err)
	}
	if api.moves != 1 || api.uploads != 0 || api.overwrites != 0 ||
		remote.normalLinks != 0 || remote.albumLinks != 0 || len(remote.openOffsets) != 0 {
		t.Fatalf("unexpected move side effects: api=%+v remote=%+v", api, remote)
	}
	if commit.Transferred || commit.TransferredBytes != 0 || commit.NodeID != nodeID || commit.NodeRevision != 4 {
		t.Fatalf("unexpected move commit: %+v", commit)
	}
}

func TestExecutorSharedLinkFailureDoesNotUpload(t *testing.T) {
	remote := &fakeDownloadRemote{linkErr: io.ErrUnexpectedEOF}
	api := newFakeYikeExecutionAPI()
	executor := NewExecutor(remote, api, 100)
	item := sourcepkg.DiscoveredItem{
		ExternalID: "yike:999:2", Kind: meta.SourceItemKindFile,
		Path: "Shared/999/fail.jpg [2]", Size: 10,
	}
	albumFile := yike.AlbumFile{
		File:    yike.File{FSID: 2, Path: "/fail.jpg", Size: 10},
		AlbumID: "shared", TID: 7, UK: 999,
	}
	_, err := executor.Execute(context.Background(), client.SourcePlan{
		ExternalID: item.ExternalID, Action: string(sourcepkg.ActionCreate),
	}, item, TransferRef{OwnUK: 123, OwnerUK: 999, File: albumFile.File, AlbumFile: &albumFile})
	if err == nil {
		t.Fatal("shared direct-link failure unexpectedly succeeded")
	}
	if remote.albumLinks != 1 || remote.normalLinks != 0 || api.uploads != 1 {
		t.Fatalf("unexpected shared failure calls: remote=%+v api=%+v", remote, api)
	}
}
