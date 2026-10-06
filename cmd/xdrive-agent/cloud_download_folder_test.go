package main

import (
	"context"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestScanAgentCloudDownloadFolderBuildsLeafManifest(t *testing.T) {
	root := client.Node{ID: 1, Name: "Projects", Type: meta.NodeTypeDir}
	tree := map[uint64][]client.Node{
		1: {
			{ID: 2, ParentID: folderDownloadUint64Ptr(1), Name: "Docs", Type: meta.NodeTypeDir},
			{ID: 3, ParentID: folderDownloadUint64Ptr(1), Name: "README.md", Type: meta.NodeTypeFile, Size: 10},
		},
		2: {
			{ID: 4, ParentID: folderDownloadUint64Ptr(2), Name: "Design.pdf", Type: meta.NodeTypeFile, Size: 20},
		},
	}
	manifest, err := scanAgentCloudDownloadFolder(
		context.Background(),
		root,
		func(_ context.Context, parentID uint64) ([]client.Node, error) {
			return append([]client.Node(nil), tree[parentID]...), nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.TotalBytes != 30 {
		t.Fatalf("total bytes=%d want 30", manifest.TotalBytes)
	}
	if len(manifest.Directories) != 2 || manifest.Directories[0] != "" || manifest.Directories[1] != "Docs" {
		t.Fatalf("directories=%v", manifest.Directories)
	}
	if len(manifest.Files) != 2 {
		t.Fatalf("files=%d want 2", len(manifest.Files))
	}
	if manifest.Files[0].RelativePath != "Docs/Design.pdf" && manifest.Files[1].RelativePath != "Docs/Design.pdf" {
		t.Fatalf("nested file path missing: %+v", manifest.Files)
	}
	if manifest.Files[0].RelativePath != "README.md" && manifest.Files[1].RelativePath != "README.md" {
		t.Fatalf("root file path missing: %+v", manifest.Files)
	}
}

func TestScanAgentCloudDownloadFolderRejectsCyclesAndUnsafeNames(t *testing.T) {
	root := client.Node{ID: 1, Name: "Projects", Type: meta.NodeTypeDir}

	_, err := scanAgentCloudDownloadFolder(
		context.Background(),
		root,
		func(_ context.Context, parentID uint64) ([]client.Node, error) {
			if parentID == 1 {
				return []client.Node{{ID: 2, ParentID: folderDownloadUint64Ptr(1), Name: "Loop", Type: meta.NodeTypeDir}}, nil
			}
			return []client.Node{{ID: 1, ParentID: folderDownloadUint64Ptr(2), Name: "Projects", Type: meta.NodeTypeDir}}, nil
		},
	)
	if err == nil || !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("cycle error=%v", err)
	}

	_, err = scanAgentCloudDownloadFolder(
		context.Background(),
		root,
		func(_ context.Context, parentID uint64) ([]client.Node, error) {
			if parentID == 1 {
				return []client.Node{{ID: 3, ParentID: folderDownloadUint64Ptr(1), Name: "../escape", Type: meta.NodeTypeFile, Size: 1}}, nil
			}
			return nil, nil
		},
	)
	if err == nil {
		t.Fatal("unsafe name must be rejected")
	}
}

func folderDownloadUint64Ptr(value uint64) *uint64 { return &value }
