package transfer

import (
	"reflect"
	"testing"
	"time"
)

// Both accounts can legitimately have the same per-manager transfer-N ID.
// A delayed Agent callback from account A must not grant account B's restored
// history permission to expose a local file path after the account is switched.
func TestOldAccountRevealCallbackCannotAuthorizeRestoredOtherAccount(t *testing.T) {
	manager := NewManager(20)
	old := manager.Start(Spec{FileName: "account-a.bin", Path: "/private/account-a.bin", Kind: KindDownload, Direction: "download"})
	newAccount := NewManager(20)
	newTask := newAccount.Start(Spec{FileName: "account-b.bin", Path: "/private/account-b.bin", Kind: KindDownload, Direction: "download"})
	newTask.Complete()
	if old.ID() != newTask.ID() {
		t.Fatalf("expected independent accounts to share task ID for this test: %q vs %q", old.ID(), newTask.ID())
	}
	history := newAccount.HistorySnapshot(10)
	if len(history) != 1 || history[0].LocalRevealable {
		t.Fatalf("account B history should not be revealable without its own Agent grant: %+v", history)
	}

	callbackQueued := make(chan struct{})
	releaseOldCallback := make(chan struct{})
	callbackDone := make(chan struct{})
	defer func() {
		select {
		case <-releaseOldCallback:
		default:
			close(releaseOldCallback)
		}
	}()
	go func() {
		close(callbackQueued)
		<-releaseOldCallback
		old.AllowLocalReveal()
		close(callbackDone)
	}()
	select {
	case <-callbackQueued:
	case <-time.After(10 * time.Second):
		t.Fatal("old-account reveal callback was not queued")
	}

	manager.Clear()
	if err := manager.RestoreHistory(history); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.LocalRevealTask(newTask.ID()); err == nil {
		t.Fatal("account B's untrusted historical path was already revealable")
	}
	beforeRevision, before := manager.Snapshot()
	close(releaseOldCallback)
	select {
	case <-callbackDone:
	case <-time.After(10 * time.Second):
		t.Fatal("old-account reveal callback did not finish")
	}
	afterRevision, after := manager.Snapshot()
	if beforeRevision != afterRevision || !reflect.DeepEqual(before, after) {
		t.Fatalf("old account callback mutated restored account B task (revision %d -> %d): before=%+v after=%+v",
			beforeRevision, afterRevision, before, after)
	}
	if task, err := manager.LocalRevealTask(newTask.ID()); err == nil {
		t.Fatalf("old account handle incorrectly authorized account B's local path: %+v", task)
	}
}
