package background

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestWakeupCoalescesSignals(t *testing.T) {
	wake := NewWakeup()
	wake.Notify()
	wake.Notify()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := Wait(ctx, wake.C(), time.Hour); err != nil {
		t.Fatal(err)
	}

	ctx2, cancel2 := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel2()
	if err := Wait(ctx2, wake.C(), 0); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("second wait err=%v, want deadline exceeded", err)
	}
}

func TestWaitFallback(t *testing.T) {
	started := time.Now()
	if err := Wait(context.Background(), nil, 10*time.Millisecond); err != nil {
		t.Fatal(err)
	}
	if time.Since(started) < 5*time.Millisecond {
		t.Fatal("fallback returned too early")
	}
}
