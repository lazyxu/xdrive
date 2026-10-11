package transfer

import (
	"context"
	"errors"
	"testing"
)

type cancelBindingResult struct {
	index int
	bound bool
}

// Competing Agent callbacks for one active transfer must not all acquire the
// same cancellation capability. Clear has to cancel the sole real I/O owner,
// rather than just the last callback to overwrite entry.cancel.
func TestConcurrentDirectCancelBindingsHaveOneOwner(t *testing.T) {
	for _, kind := range []string{KindUpload, KindDownload} {
		t.Run(kind, func(t *testing.T) {
			const contenders = 24
			manager := NewManager(8)
			h := manager.Start(Spec{FileName: "account-a.bin", Kind: kind, Direction: kind})
			contexts := make([]context.Context, contenders)
			cancels := make([]context.CancelFunc, contenders)
			for i := range contexts {
				contexts[i], cancels[i] = context.WithCancel(context.Background())
				defer cancels[i]()
			}
			start := make(chan struct{})
			results := make(chan cancelBindingResult, contenders)
			for i := range contexts {
				go func(index int) {
					<-start
					results <- cancelBindingResult{index: index, bound: h.BindCancel(cancels[index])}
				}(i)
			}
			close(start)
			owners := make([]bool, contenders)
			ownerCount := 0
			for i := 0; i < contenders; i++ {
				r := <-results
				owners[r.index] = r.bound
				if r.bound {
					ownerCount++
				}
			}
			manager.Clear()
			if ownerCount != 1 {
				t.Errorf("%d Agent requests acquired the same transfer cancellation owner; want exactly 1", ownerCount)
			}
			for i, ctx := range contexts {
				cancelled := errors.Is(ctx.Err(), context.Canceled)
				if cancelled != owners[i] {
					t.Errorf("candidate %d: owner=%v, cancelled after account Clear=%v", i, owners[i], cancelled)
				}
			}
		})
	}
}

// An original upload or download can still be running when more callbacks
// attempt to rebind its handle. Those callbacks must not detach its original
// Context; an account switch must cancel that first I/O owner.
func TestRebindingDirectCancelCannotOrphanOldAccountTransport(t *testing.T) {
	manager := NewManager(8)
	h := manager.Start(Spec{FileName: "old-account-download.bin", Kind: KindDownload, Direction: "download"})
	originalCtx, cancelOriginal := context.WithCancel(context.Background())
	defer cancelOriginal()
	if !h.BindCancel(cancelOriginal) {
		t.Fatal("the original Agent transport could not acquire its cancel binding")
	}

	const contenders = 16
	contexts := make([]context.Context, contenders)
	cancels := make([]context.CancelFunc, contenders)
	for i := range contexts {
		contexts[i], cancels[i] = context.WithCancel(context.Background())
		defer cancels[i]()
	}
	start := make(chan struct{})
	results := make(chan bool, contenders)
	for i := range contexts {
		go func(index int) {
			<-start
			results <- h.BindCancel(cancels[index])
		}(i)
	}
	close(start)
	accepted := 0
	for i := 0; i < contenders; i++ {
		if <-results {
			accepted++
		}
	}
	manager.Clear()
	if accepted != 0 {
		t.Errorf("%d late callbacks overwrote the active Agent transport owner", accepted)
	}
	if !errors.Is(originalCtx.Err(), context.Canceled) {
		t.Errorf("old account I/O survived Clear after competing bindings: %v", originalCtx.Err())
	}
	for i, ctx := range contexts {
		if ctx.Err() != nil {
			t.Errorf("unowned candidate %d was cancelled instead of the original transfer", i)
		}
	}
}
