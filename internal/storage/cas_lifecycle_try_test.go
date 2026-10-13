package storage

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

func TestLocalCASTryPinnedCASReportsBusyWithoutBlocking(t *testing.T) {
	root := t.TempDir()
	reader, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	writer, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	key := lifecycleTestKey(t, "native-local-content")
	body := "native-local-content"
	if _, err := writer.Put(context.Background(), key, strings.NewReader(body)); err != nil {
		t.Fatal(err)
	}
	hash, ok := canonicalCASDigest(key)
	if !ok {
		t.Fatal("fixture is not a canonical CAS hash")
	}
	release, err := writer.casLifecycleLease(context.Background(), hash, true)
	if err != nil {
		t.Fatal(err)
	}
	held := true
	defer func() {
		if held {
			release()
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 350*time.Millisecond)
	defer cancel()
	pinned, acquired, err := reader.TryOpenPinnedCAS(ctx, key)
	if err != nil || acquired || pinned != nil {
		t.Fatalf("busy exclusive CAS shard became shared pin: %v acquired=%t", err, acquired)
	}
	if ctx.Err() != nil {
		t.Fatalf("nonblocking shared CAS attempt waited for context deadline: %v", ctx.Err())
	}
	release()
	held = false

	pinned, acquired, err = reader.TryOpenPinnedCAS(context.Background(), key)
	if err != nil || !acquired || pinned == nil {
		t.Fatalf("uncontended canonical CAS could not be pinned: %v acquired=%t", err, acquired)
	}
	read, err := io.ReadAll(pinned)
	if err != nil || string(read) != body {
		t.Fatalf("pinned CAS content differs: %q %v", read, err)
	}
	// Even a try-admitted reader must hold its lease until Close.
	waitCtx, stop := context.WithTimeout(context.Background(), 150*time.Millisecond)
	if err := writer.Delete(waitCtx, key); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("canonical delete passed an active shared pin: %v", err)
	}
	stop()
	if err := pinned.Close(); err != nil {
		t.Fatal(err)
	}
	if err := writer.Delete(context.Background(), key); err != nil {
		t.Fatalf("try-admitted read lease was not released: %v", err)
	}
}

func TestLocalCASTryPinnedCASRejectsInvalidMissingAndCanceled(t *testing.T) {
	store, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	key := lifecycleTestKey(t, "missing")
	if pinned, acquired, err := store.TryOpenPinnedCAS(context.Background(), "temporary/not-cas"); err == nil || acquired || pinned != nil {
		t.Fatalf("noncanonical key admitted: pin=%v acquired=%t err=%v", pinned, acquired, err)
	}
	if pinned, acquired, err := store.TryOpenPinnedCAS(context.Background(), key); err == nil || acquired || pinned != nil {
		t.Fatalf("missing canonical bytes admitted: pin=%v acquired=%t err=%v", pinned, acquired, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if pinned, acquired, err := store.TryOpenPinnedCAS(ctx, key); !errors.Is(err, context.Canceled) || acquired || pinned != nil {
		t.Fatalf("canceled CAS admission accepted: pin=%v acquired=%t err=%v", pinned, acquired, err)
	}
}
