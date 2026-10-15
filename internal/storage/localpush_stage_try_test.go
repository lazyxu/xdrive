package storage

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

func TestLocalPushTryPinnedStageBusyAndRelease(t *testing.T) {
	root := t.TempDir()
	reader, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	writer, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	key := localPushTestStageKey()
	body := "temporary-owning-agent-original"
	if _, err := writer.Put(context.Background(), key, strings.NewReader(body)); err != nil {
		t.Fatal(err)
	}
	shard, managed, err := localPushStageShard(key)
	if err != nil || !managed {
		t.Fatalf("invalid exact private stage fixture: shard=%q err=%v", shard, err)
	}
	release, err := writer.localPushStageShardLease(context.Background(), shard, true)
	if err != nil {
		t.Fatal(err)
	}
	held := true
	defer func() {
		if held {
			release()
		}
	}()
	tryCtx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
	defer cancel()
	pinned, acquired, err := reader.TryOpenPinnedLocalPushStage(tryCtx, key)
	if pinned != nil {
		_ = pinned.Close()
	}
	if err != nil || acquired || pinned != nil || tryCtx.Err() != nil {
		t.Fatalf("busy stage shard became a blocking or successful read: pin=%v acquired=%t err=%v ctx=%v",
			pinned, acquired, err, tryCtx.Err())
	}
	release()
	held = false
	pinned, acquired, err = reader.TryOpenPinnedLocalPushStage(context.Background(), key)
	if err != nil || !acquired || pinned == nil {
		t.Fatalf("uncontended stage try-pin was denied: pin=%v err=%v", pinned, err)
	}
	got, readErr := io.ReadAll(pinned)
	if readErr != nil || string(got) != body {
		t.Fatalf("pinned stage bytes differ: %q err=%v", got, readErr)
	}
	waitCtx, stop := context.WithTimeout(context.Background(), 140*time.Millisecond)
	if err := writer.DeleteStaging(waitCtx, key); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("janitor removed bytes while try-pin remained open: %v", err)
	}
	stop()
	if err := pinned.Close(); err != nil {
		t.Fatal(err)
	}
	if err := writer.DeleteStaging(context.Background(), key); err != nil {
		t.Fatalf("temporary stage try-pin lease was not released on Close: %v", err)
	}
}

func TestLocalPushTryPinnedStageFailClosed(t *testing.T) {
	reader, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	key := localPushTestStageKey()
	for _, invalid := range []string{
		"", "upload/not-stage",
		UploadStagingDir + "/localpush/not-uuid.part",
	} {
		if file, acquired, err := reader.TryOpenPinnedLocalPushStage(context.Background(), invalid); err == nil || acquired || file != nil {
			if file != nil {
				_ = file.Close()
			}
			t.Fatalf("invalid temporary stage pin accepted: key=%q acquired=%t err=%v", invalid, acquired, err)
		}
	}
	if file, acquired, err := reader.TryOpenPinnedLocalPushStage(context.Background(), key); err == nil || acquired || file != nil {
		if file != nil {
			_ = file.Close()
		}
		t.Fatalf("missing temporary stage pin accepted: acquired=%t err=%v", acquired, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if file, acquired, err := reader.TryOpenPinnedLocalPushStage(ctx, key); !errors.Is(err, context.Canceled) || acquired || file != nil {
		if file != nil {
			_ = file.Close()
		}
		t.Fatalf("canceled temporary stage read admitted: acquired=%t err=%v", acquired, err)
	}
}
