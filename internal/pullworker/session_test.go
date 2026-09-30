package pullworker

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestWatchRunCancellationCancelsActiveContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var checks atomic.Int32
	go watchRunCancellation(
		ctx,
		5*time.Millisecond,
		func(context.Context) (bool, error) {
			return checks.Add(1) >= 3, nil
		},
		cancel,
	)

	select {
	case <-ctx.Done():
	case <-time.After(250 * time.Millisecond):
		t.Fatal("run context was not cancelled")
	}
	if got := checks.Load(); got < 3 {
		t.Fatalf("checks=%d want>=3", got)
	}
}

func TestWatchRunCancellationIgnoresTransientProbeError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var checks atomic.Int32
	go watchRunCancellation(
		ctx,
		5*time.Millisecond,
		func(context.Context) (bool, error) {
			switch checks.Add(1) {
			case 1:
				return false, errors.New("temporary database error")
			case 2:
				return false, nil
			default:
				return true, nil
			}
		},
		cancel,
	)

	select {
	case <-ctx.Done():
	case <-time.After(250 * time.Millisecond):
		t.Fatal("run context was not cancelled after probe recovered")
	}
	if got := checks.Load(); got < 3 {
		t.Fatalf("checks=%d want>=3", got)
	}
}

func TestWatchRunCancellationStopsWithParentContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var checks atomic.Int32
	done := make(chan struct{})
	go func() {
		defer close(done)
		watchRunCancellation(
			ctx,
			5*time.Millisecond,
			func(context.Context) (bool, error) {
				checks.Add(1)
				return false, nil
			},
			func() {},
		)
	}()

	time.Sleep(15 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("cancellation watcher did not stop")
	}
}
