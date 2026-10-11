package transfer

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A retry may observe cancellation, finish cleanup and return nil. That
// acknowledgement must not count as a successful transfer, nor strand an
// explicitly cancelled retry in the nonterminal "cancelling" state.
func TestRetryContextCancellationCleanExitCannotCommitSuccess(t *testing.T) {
	cases := []struct {
		name           string
		explicitCancel bool
		returnCtxError bool
	}{
		{name: "explicit-cancel-clean-return", explicitCancel: true},
		{name: "parent-cancel-clean-return"},
		{name: "parent-cancel-context-error", returnCtxError: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			manager := NewManager(8)
			retryStarted := make(chan struct{})
			h := manager.Start(Spec{
				FileName: "retry-cancel.bin", Kind: KindUpload, Direction: "upload",
				TotalBytes: 100,
				Retry: func(retryCtx context.Context) error {
					close(retryStarted)
					<-retryCtx.Done()
					if tc.returnCtxError {
						return retryCtx.Err()
					}
					// Cleanup succeeded after the owned context was cancelled.
					return nil
				},
			})
			h.Fail(errors.New("initial transient error"))
			retryResult := make(chan error, 1)
			go func() { retryResult <- manager.Retry(ctx, h.ID()) }()
			select {
			case <-retryStarted:
			case <-time.After(10 * time.Second):
				t.Fatal("retry did not start")
			}
			if tc.explicitCancel {
				if !h.BindCancel(cancel) {
					t.Fatal("running retry could not bind its owned cancel callback")
				}
				if err := manager.Cancel(h.ID()); err != nil {
					t.Fatalf("cancel active retry: %v", err)
				}
			} else {
				cancel()
			}
			select {
			case err := <-retryResult:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("cancelled retry returned %v, want context.Canceled", err)
				}
			case <-time.After(10 * time.Second):
				t.Fatal("cancelled retry did not return")
			}
			_, tasks := manager.Snapshot()
			if len(tasks) != 1 || tasks[0].State != StateCancelled ||
				tasks[0].Cancelable || tasks[0].CompletedAt == nil ||
				tasks[0].ItemsCompleted != 0 || tasks[0].Percent == 100 {
				t.Fatalf("cancelled retry was stranded or committed as success/failure: %+v", tasks)
			}
		})
	}
}
