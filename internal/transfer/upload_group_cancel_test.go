package transfer

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Cancel must interrupt the real in-flight HTTP request, not only a task label.
func TestUploadGroupCancelAbortsRealHTTPAndLeavesOtherGroup(t *testing.T) {
	manager := NewManager(20)
	group := manager.StartGroup(Spec{FileName: "A", Kind: KindUpload, Direction: "upload"})
	owner, stopOwner := context.WithCancel(context.Background())
	defer stopOwner()
	if !group.BindGroupCancelContext(owner, stopOwner) {
		t.Fatal("group needs owner cancel context")
	}
	child := manager.StartChildByID(group.ID(), Spec{FileName: "a.bin", Kind: KindUpload, Direction: "upload"})
	if child == nil {
		t.Fatal("missing upload child")
	}
	independent := manager.StartGroup(Spec{FileName: "B", Kind: KindUpload, Direction: "upload"})
	otherOwner, otherStop := context.WithCancel(context.Background())
	defer otherStop()
	if !independent.BindGroupCancelContext(otherOwner, otherStop) {
		t.Fatal("missing second owner")
	}
	serverStarted := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(serverStarted)
		<-r.Context().Done()
	}))
	defer server.Close()
	childCtx, done, err := manager.UploadGroupContext(context.Background(), child.ID(), true)
	if err != nil {
		t.Fatal(err)
	}
	defer done()
	req, err := http.NewRequestWithContext(childCtx, http.MethodPost, server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() {
		resp, err := server.Client().Do(req)
		if resp != nil {
			_ = resp.Body.Close()
		}
		finished <- err
	}()
	select {
	case <-serverStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("HTTP upload was not dispatched")
	}
	if err := manager.Cancel(group.ID()); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-finished:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("HTTP request should abort: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancel did not abort HTTP upload")
	}
	if otherOwner.Err() != nil {
		t.Fatal("cancelled unrelated upload group")
	}
	if _, _, err := manager.UploadGroupContext(context.Background(), group.ID(), false); !errors.Is(err, context.Canceled) {
		t.Fatalf("preflight must be fenced after group cancel: %v", err)
	}
	if _, _, err := manager.UploadGroupContext(context.Background(), child.ID(), true); !errors.Is(err, context.Canceled) {
		t.Fatalf("child upload must be fenced after group cancel: %v", err)
	}
	if err := child.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatal(err)
	}
	if err := group.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatal(err)
	}
	if err := independent.Finish(StateCompleted, nil); err != nil {
		t.Fatal(err)
	}
}

func TestUploadGroupCancelOnAccountClearAndFinish(t *testing.T) {
	manager := NewManager(20)
	group := manager.StartGroup(Spec{FileName: "folder", Kind: KindUpload, Direction: "upload"})
	owner, cancel := context.WithCancel(context.Background())
	defer cancel()
	if !group.BindGroupCancelContext(owner, cancel) {
		t.Fatal("missing cancellation owner")
	}
	ctx, release, err := manager.UploadGroupContext(context.Background(), group.ID(), false)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	manager.Clear()
	select {
	case <-ctx.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("account switch left group work running")
	}
	group2 := manager.StartGroup(Spec{FileName: "another", Kind: KindUpload, Direction: "upload"})
	owner2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	if !group2.BindGroupCancelContext(owner2, cancel2) {
		t.Fatal("missing owner")
	}
	reqCtx, release2, err := manager.UploadGroupContext(context.Background(), group2.ID(), false)
	if err != nil {
		t.Fatal(err)
	}
	defer release2()
	if err := group2.Finish(StateCompleted, nil); err != nil {
		t.Fatal(err)
	}
	select {
	case <-reqCtx.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("terminal group leaked cancellation lifetime")
	}
}

func TestUploadGroupRejectsCrossGroupChildAndNonUploadOwner(t *testing.T) {
	manager := NewManager(10)
	normal := manager.StartGroup(Spec{Kind: KindDownload, Direction: "download"})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if normal.BindGroupCancelContext(ctx, cancel) {
		t.Fatal("downloads cannot impersonate upload group")
	}
	root := manager.StartGroup(Spec{Kind: KindUpload, Direction: "upload"})
	if !root.BindGroupCancelContext(ctx, cancel) {
		t.Fatal("owner bind failed")
	}
	other := manager.Start(Spec{Kind: KindUpload, Direction: "upload"})
	if _, _, err := manager.UploadGroupContext(context.Background(), other.ID(), true); !errors.Is(err, context.Canceled) {
		t.Fatalf("standalone upload must not inherit group: %v", err)
	}
	if err := manager.Cancel(root.ID()); err != nil {
		t.Fatal(err)
	}
	if handles := manager.StartChildrenByID(root.ID(), []Spec{{Kind: KindUpload, Direction: "upload"}}); len(handles) != 0 {
		t.Fatalf("cancelling root must not queue children, got %d", len(handles))
	}
}
