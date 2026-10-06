package background

import (
	"context"
	"time"
)

// Wakeup is an edge-triggered, coalescing signal. Multiple Notify calls before
// a waiter consumes the signal collapse into one wakeup, which is the desired
// behavior for DB-backed workers that reconcile all currently runnable work.
type Wakeup struct {
	ch chan struct{}
}

func NewWakeup() *Wakeup {
	return &Wakeup{ch: make(chan struct{}, 1)}
}

func (w *Wakeup) Notify() {
	if w == nil {
		return
	}
	select {
	case w.ch <- struct{}{}:
	default:
	}
}

func (w *Wakeup) C() <-chan struct{} {
	if w == nil {
		return nil
	}
	return w.ch
}

// Wait blocks until a wakeup arrives, the fallback interval expires, or ctx is
// cancelled. A non-positive fallback disables the timer and waits only for a
// wakeup or cancellation.
func Wait(ctx context.Context, wake <-chan struct{}, fallback time.Duration) error {
	if fallback <= 0 {
		select {
		case <-ctx.Done():
			return context.Cause(ctx)
		case <-wake:
			return nil
		}
	}

	timer := time.NewTimer(fallback)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return context.Cause(ctx)
	case <-wake:
		return nil
	case <-timer.C:
		return nil
	}
}
