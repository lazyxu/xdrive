package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

func lifecycleTestKey(t *testing.T, data string) string {
	t.Helper()
	digest := sha256.Sum256([]byte(data))
	key, err := ContentAddressedKey(hex.EncodeToString(digest[:]))
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func TestLocalCASPinnedReadFencesPutDeleteAndPromoteAcrossInstances(t *testing.T) {
	root := t.TempDir()
	reader, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	writer, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	key := lifecycleTestKey(t, "original")
	if _, err := writer.Put(context.Background(), key, strings.NewReader("original")); err != nil {
		t.Fatal(err)
	}
	lease, err := reader.OpenPinnedCAS(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	if info, err := lease.Stat(); err != nil || info.Size() != 8 {
		t.Fatalf("pinned CAS stat %v, %v", info, err)
	}

	blocked := func(name string, operation func(context.Context) error) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 170*time.Millisecond)
		defer cancel()
		if err := operation(ctx); !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("%s passed pinned reader: %v", name, err)
		}
	}
	blocked("put", func(ctx context.Context) error {
		_, err := writer.Put(ctx, key, strings.NewReader("modified"))
		return err
	})
	blocked("delete", func(ctx context.Context) error { return writer.Delete(ctx, key) })
	tmp := "temporary/promotion"
	if _, err := writer.Put(context.Background(), tmp, strings.NewReader("original")); err != nil {
		t.Fatal(err)
	}
	blocked("promote", func(ctx context.Context) error { return writer.Promote(ctx, tmp, key, 8) })
	data, err := io.ReadAll(lease)
	if err != nil || string(data) != "original" {
		t.Fatalf("pinned CAS changed: %q %v", data, err)
	}
	if err := lease.Close(); err != nil {
		t.Fatal(err)
	}
	if err := writer.Delete(context.Background(), key); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Put(context.Background(), key, strings.NewReader("original")); err != nil {
		t.Fatal(err)
	}
}

func TestLocalCASReadLeaseFailsClosedAndDifferentShardsProceed(t *testing.T) {
	root := t.TempDir()
	first, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	key := lifecycleTestKey(t, "A")
	if _, err := first.OpenPinnedCAS(context.Background(), "non-cas-key"); err == nil {
		t.Fatal("noncanonical CAS key accepted")
	}
	if _, err := first.OpenPinnedCAS(context.Background(), key); err == nil {
		t.Fatal("missing physical CAS file accepted")
	}
	if _, err := first.Put(context.Background(), key, strings.NewReader("A")); err != nil {
		t.Fatal(err)
	}
	lease, err := first.OpenPinnedCAS(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	other := lifecycleTestKey(t, "B")
	if other[:len(ContentBlobDir)+10] == key[:len(ContentBlobDir)+10] {
		t.Skip("test fixtures collided on a shard")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := second.Put(ctx, other, strings.NewReader("B")); err != nil {
		t.Fatalf("distinct CAS shard should not wait: %v", err)
	}
	canceled, stop := context.WithCancel(context.Background())
	stop()
	if _, err := second.OpenPinnedCAS(canceled, key); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled CAS read was accepted: %v", err)
	}
	if err := lease.Close(); err != nil {
		t.Fatal(err)
	}
}
