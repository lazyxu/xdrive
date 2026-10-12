package transfer

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// A direct transfer's Cancel may enter the owner's callback before its
// transport has actually stopped. A concurrent terminal Finish must not
// detach the cancellation handoff that account Clear needs to join.
func TestDirectCancelTerminalFinishClearJoinsTransport(t *testing.T) {
	for _, kind := range []string{KindUpload, KindDownload} {
		t.Run(kind, func(t *testing.T) {
			m := NewManager(8)
			h := m.Start(Spec{FileName: "account-a-transfer.bin", Kind: kind, Direction: kind})
			transportCtx, cancelTransport := context.WithCancel(context.Background())
			defer cancelTransport()
			cancelEntered := make(chan struct{})
			allowCancel := make(chan struct{})
			var once sync.Once
			release := func() { once.Do(func() { close(allowCancel) }) }
			defer release()
			if !h.BindCancel(func() {
				close(cancelEntered)
				<-allowCancel
				cancelTransport()
			}) {
				t.Fatal("could not bind original direct transfer owner")
			}
			cancelDone := make(chan error, 1)
			go func() { cancelDone <- m.Cancel(h.ID()) }()
			select {
			case <-cancelEntered:
			case <-time.After(10 * time.Second):
				t.Fatal("Cancel did not enter its transport callback")
			}
			if err := h.Finish(StateCancelled, context.Canceled); err != nil {
				t.Fatalf("I/O owner did not publish cancellation: %v", err)
			}
			clearDone := make(chan struct{})
			go func() { m.Clear(); close(clearDone) }()
			premature := false
			select {
			case <-clearDone:
				premature = !errors.Is(transportCtx.Err(), context.Canceled)
			case <-time.After(150 * time.Millisecond):
				// Account Clear is still joining the outstanding I/O teardown.
			}
			release()
			select {
			case err := <-cancelDone:
				if err != nil {
					t.Errorf("original Cancel returned %v", err)
				}
			case <-time.After(10 * time.Second):
				t.Fatal("original Cancel did not finish")
			}
			select {
			case <-clearDone:
			case <-time.After(10 * time.Second):
				t.Fatal("account Clear did not finish after transport cancellation")
			}
			if premature {
				t.Error("account Clear returned while the old direct transfer cancellation callback was still pending")
			}
			if !errors.Is(transportCtx.Err(), context.Canceled) {
				t.Fatalf("old account transport was not cancelled: %v", transportCtx.Err())
			}
			if _, tasks := m.Snapshot(); len(tasks) != 0 {
				t.Fatalf("account Clear retained old transfer records: %+v", tasks)
			}
		})
	}
}

// Terminal publication is not the same as completion of the direct transfer
// cancellation callback. Neither history removal nor durable persistence may
// treat that root as settled until the transport owner has finished cleanup.
func TestDirectCancelTerminalHistoryWaitsForTransport(t *testing.T) {
	m := NewManager(8)
	h := m.Start(Spec{FileName: "account-a-download.bin", Kind: KindDownload, Direction: "download"})
	transportCtx, cancelTransport := context.WithCancel(context.Background())
	defer cancelTransport()
	entered := make(chan struct{})
	allowCancel := make(chan struct{})
	var once sync.Once
	release := func() { once.Do(func() { close(allowCancel) }) }
	defer release()
	if !h.BindCancel(func() {
		close(entered)
		<-allowCancel
		cancelTransport()
	}) {
		t.Fatal("could not bind original direct transfer owner")
	}
	cancelDone := make(chan error, 1)
	go func() { cancelDone <- m.Cancel(h.ID()) }()
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("Cancel callback was not entered")
	}
	if err := h.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatalf("failed to publish terminal state: %v", err)
	}
	if premature := m.HistorySnapshot(10); len(premature) != 0 {
		t.Errorf("unsettled direct transfer was persisted before I/O cancellation: %+v", premature)
	}
	m.ClearHistory("network")
	if _, visible := m.Snapshot(); len(visible) != 1 || visible[0].ID != h.ID() {
		t.Errorf("ClearHistory removed terminal transfer before its pending cancellation completed: %+v", visible)
	}
	for {
		select {
		case <-m.HistoryEvents():
		default:
			goto drained
		}
	}
drained:
	release()
	select {
	case err := <-cancelDone:
		if err != nil {
			t.Errorf("Cancel returned %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Cancel never completed")
	}
	if !errors.Is(transportCtx.Err(), context.Canceled) {
		t.Fatalf("transport Context remained alive: %v", transportCtx.Err())
	}
	history := m.HistorySnapshot(10)
	if len(history) != 1 || history[0].ID != h.ID() || history[0].State != StateCancelled {
		t.Errorf("settled direct transfer was not available for durable history: %+v", history)
	}
	select {
	case <-m.HistoryEvents():
	default:
		t.Error("history writer was not notified after direct cancellation handoff completed")
	}
}
