package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/transfer"
)

func TestAgentFolderScanCanBeCancelledByOwnedRootTask(t *testing.T) {
	manager := transfer.NewManager(5)
	root := manager.StartGroup(transfer.Spec{
		FileName:  "large-folder",
		Kind:      transfer.KindDownload,
		Direction: "download",
		Phase:     transfer.PhaseScanning,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if !root.BindCancel(cancel) {
		t.Fatal("real Agent folder group must bind its own context")
	}
	scanStarted := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		_, err := scanAgentCloudDownloadFolder(
			ctx,
			client.Node{ID: 3, Name: "large-folder", Type: meta.NodeTypeDir},
			func(ctx context.Context, _ uint64, _ client.ChildrenOptions) (client.ChildrenPage, error) {
				close(scanStarted)
				<-ctx.Done()
				return client.ChildrenPage{}, ctx.Err()
			},
		)
		result <- err
	}()
	select {
	case <-scanStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("directory scan never entered the remote pager")
	}
	if err := manager.Cancel(root.ID()); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("remote directory scan should stop immediately, got %v", err)
		}
		_ = root.Finish(transfer.StateCancelled, err)
	case <-time.After(3 * time.Second):
		t.Fatal("task cancellation failed to stop a remote directory page request")
	}
	_, tasks := manager.Snapshot()
	if len(tasks) != 1 || tasks[0].State != transfer.StateCancelled ||
		tasks[0].Cancelable || tasks[0].ItemsRunning != 0 {
		t.Fatalf("cancelled folder scan must be terminal and nonrepeatable: %+v", tasks)
	}
}

func TestAgentFolderPartialCancelKeepsAlreadyCommittedChild(t *testing.T) {
	manager := transfer.NewManager(10)
	root := manager.StartGroup(transfer.Spec{
		FileName:  "folder",
		Kind:      transfer.KindDownload,
		Direction: "download",
	})
	handles := manager.StartChildrenByID(root.ID(), []transfer.Spec{
		{FileName: "done.jpg", Kind: transfer.KindDownload, Direction: "download"},
		{FileName: "active.jpg", Kind: transfer.KindDownload, Direction: "download"},
		{FileName: "queued.jpg", Kind: transfer.KindDownload, Direction: "download"},
	})
	if len(handles) != 3 {
		t.Fatalf("expected three child transfer handles, got %d", len(handles))
	}
	handles[0].Complete()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if !root.BindCancel(cancel) {
		t.Fatal("root must support cancellation")
	}
	if err := manager.Cancel(root.ID()); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatal("cancel root must stop owner context")
	}
	for _, child := range handles[1:] {
		if err := child.Finish(transfer.StateCancelled, ctx.Err()); err != nil {
			t.Fatal(err)
		}
	}
	if err := root.Finish(transfer.StatePartial, ctx.Err()); err != nil {
		t.Fatal(err)
	}
	_, tasks := manager.Snapshot()
	states := make(map[string]string)
	for _, task := range tasks {
		states[task.FileName] = task.State
	}
	if states["done.jpg"] != transfer.StateCompleted ||
		states["active.jpg"] != transfer.StateCancelled ||
		states["queued.jpg"] != transfer.StateCancelled ||
		states["folder"] != transfer.StatePartial {
		t.Fatalf("partially cancelled folder must preserve prior completed file: %v", states)
	}
}
