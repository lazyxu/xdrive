package main

import (
	"context"
	"strconv"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestAgentCloudFolderDownloadByteProgressIsIncremental(t *testing.T) {
	progress := newAgentCloudFolderDownloadByteProgress(300)
	currentDone := int64(0)
	currentTotal := int64(100)

	progress.update(&currentDone, &currentTotal, 20, 100)
	if progress.done != 20 || progress.total != 300 {
		t.Fatalf("first update done/total=%d/%d want 20/300", progress.done, progress.total)
	}

	progress.update(&currentDone, &currentTotal, 60, 120)
	if progress.done != 60 || progress.total != 320 || currentDone != 60 || currentTotal != 120 {
		t.Fatalf(
			"corrected update done/total/current=%d/%d/%d/%d want 60/320/60/120",
			progress.done, progress.total, currentDone, currentTotal,
		)
	}

	progress.complete(&currentDone, &currentTotal)
	if progress.done != 120 || progress.total != 320 || currentDone != 120 {
		t.Fatalf("complete done/total/current=%d/%d/%d want 120/320/120", progress.done, progress.total, currentDone)
	}

	failedDone := int64(0)
	failedTotal := int64(200)
	progress.update(&failedDone, &failedTotal, 50, 200)
	if progress.done != 170 || progress.total != 320 {
		t.Fatalf("failed partial progress done/total=%d/%d want 170/320", progress.done, progress.total)
	}
}

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
		folderDownloadPagedTree(tree, nil),
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

func TestScanAgentCloudDownloadFolderPagesWideDirectories(t *testing.T) {
	root := client.Node{ID: 1, Name: "Wide", Type: meta.NodeTypeDir}
	children := make([]client.Node, 1201)
	for index := range children {
		children[index] = client.Node{
			ID:       uint64(index + 2),
			ParentID: folderDownloadUint64Ptr(root.ID),
			Name:     "file-" + strconv.Itoa(index) + ".txt",
			Type:     meta.NodeTypeFile,
			Size:     1,
		}
	}
	pageCalls := 0
	maxReturned := 0
	pager := folderDownloadPagedTree(
		map[uint64][]client.Node{root.ID: children},
		func(parentID uint64, options client.ChildrenOptions, returned int) {
			if parentID != root.ID {
				t.Fatalf("parent id=%d want %d", parentID, root.ID)
			}
			if options.Limit != agentCloudDownloadChildrenPageLimit {
				t.Fatalf("page limit=%d want %d", options.Limit, agentCloudDownloadChildrenPageLimit)
			}
			if options.Sort != "name" || options.Order != "asc" {
				t.Fatalf("page order=%s/%s want name/asc", options.Sort, options.Order)
			}
			pageCalls++
			if returned > maxReturned {
				maxReturned = returned
			}
		},
	)

	manifest, err := scanAgentCloudDownloadFolder(context.Background(), root, pager)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Files) != len(children) || manifest.TotalBytes != int64(len(children)) {
		t.Fatalf("manifest files=%d bytes=%d want=%d/%d", len(manifest.Files), manifest.TotalBytes, len(children), len(children))
	}
	if pageCalls != 3 {
		t.Fatalf("page calls=%d want 3", pageCalls)
	}
	if maxReturned != agentCloudDownloadChildrenPageLimit {
		t.Fatalf("max returned=%d want %d", maxReturned, agentCloudDownloadChildrenPageLimit)
	}
}

func TestResolveAgentCloudDownloadFolderRootUsesExactNodeLookup(t *testing.T) {
	const (
		parentID     = uint64(10)
		siblingCount = 1201
	)
	target := client.Node{
		ID:       uint64(siblingCount + 100),
		ParentID: folderDownloadUint64Ptr(parentID),
		Name:     "Folder-1200",
		Type:     meta.NodeTypeDir,
	}
	calls := 0
	getter := func(_ context.Context, id uint64) (client.Node, error) {
		calls++
		if id != target.ID {
			t.Fatalf("node id=%d want %d", id, target.ID)
		}
		return target, nil
	}
	got, err := resolveAgentCloudDownloadFolderRoot(context.Background(), target.ID, parentID, getter)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != target.ID || got.Name != target.Name {
		t.Fatalf("resolved root=%+v want=%+v", got, target)
	}
	if calls != 1 {
		t.Fatalf("exact lookup calls=%d want 1 for %d logical siblings", calls, siblingCount)
	}
	_, err = resolveAgentCloudDownloadFolderRoot(context.Background(), target.ID, parentID+1, getter)
	if err == nil || !strings.Contains(err.Error(), "no longer available") {
		t.Fatalf("mismatched parent error=%v", err)
	}
	if calls != 2 {
		t.Fatalf("exact lookup calls after parent check=%d want 2", calls)
	}
}

func TestScanAgentCloudDownloadFolderRejectsCyclesAndUnsafeNames(t *testing.T) {
	root := client.Node{ID: 1, Name: "Projects", Type: meta.NodeTypeDir}

	_, err := scanAgentCloudDownloadFolder(
		context.Background(),
		root,
		folderDownloadPagedTree(map[uint64][]client.Node{
			1: {{ID: 2, ParentID: folderDownloadUint64Ptr(1), Name: "Loop", Type: meta.NodeTypeDir}},
			2: {{ID: 1, ParentID: folderDownloadUint64Ptr(2), Name: "Projects", Type: meta.NodeTypeDir}},
		}, nil),
	)
	if err == nil || !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("cycle error=%v", err)
	}

	_, err = scanAgentCloudDownloadFolder(
		context.Background(),
		root,
		folderDownloadPagedTree(map[uint64][]client.Node{
			1: {{ID: 3, ParentID: folderDownloadUint64Ptr(1), Name: "../escape", Type: meta.NodeTypeFile, Size: 1}},
		}, nil),
	)
	if err == nil {
		t.Fatal("unsafe name must be rejected")
	}
}

func TestScanAgentCloudDownloadFolderRejectsRepeatedCursor(t *testing.T) {
	root := client.Node{ID: 1, Name: "Projects", Type: meta.NodeTypeDir}
	calls := 0
	_, err := scanAgentCloudDownloadFolder(
		context.Background(),
		root,
		func(_ context.Context, _ uint64, options client.ChildrenOptions) (client.ChildrenPage, error) {
			calls++
			if options.Cursor == "" {
				return client.ChildrenPage{HasMore: true, NextCursor: "repeat"}, nil
			}
			return client.ChildrenPage{HasMore: true, NextCursor: "repeat"}, nil
		},
	)
	if err == nil || !strings.Contains(err.Error(), "repeated cursor") {
		t.Fatalf("cursor error=%v", err)
	}
	if calls != 2 {
		t.Fatalf("page calls=%d want 2", calls)
	}
}

func folderDownloadPagedTree(
	tree map[uint64][]client.Node,
	onPage func(uint64, client.ChildrenOptions, int),
) agentCloudDownloadChildrenPageFunc {
	return func(
		_ context.Context,
		parentID uint64,
		options client.ChildrenOptions,
	) (client.ChildrenPage, error) {
		start := 0
		if options.Cursor != "" {
			parsed, err := strconv.Atoi(options.Cursor)
			if err != nil {
				return client.ChildrenPage{}, err
			}
			start = parsed
		}
		items := tree[parentID]
		if start > len(items) {
			start = len(items)
		}
		limit := options.Limit
		if limit <= 0 {
			limit = len(items)
		}
		end := start + limit
		if end > len(items) {
			end = len(items)
		}
		pageItems := append([]client.Node(nil), items[start:end]...)
		hasMore := end < len(items)
		nextCursor := ""
		if hasMore {
			nextCursor = strconv.Itoa(end)
		}
		if onPage != nil {
			onPage(parentID, options, len(pageItems))
		}
		return client.ChildrenPage{
			Items:      pageItems,
			NextCursor: nextCursor,
			HasMore:    hasMore,
			Sort:       options.Sort,
			Order:      options.Order,
		}, nil
	}
}

func folderDownloadUint64Ptr(value uint64) *uint64 { return &value }
