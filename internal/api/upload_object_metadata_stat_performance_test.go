package api

import (
	"bytes"
	"context"
	"os"
	"sync"
	"testing"

	"github.com/lazyxu/xdrive/internal/storage"
)

type countingMetadataStore struct {
	*storage.Local

	mu    sync.Mutex
	opens int
	stats int
}

func (s *countingMetadataStore) Open(ctx context.Context, key string) (*os.File, error) {
	s.mu.Lock()
	s.opens++
	s.mu.Unlock()
	return s.Local.Open(ctx, key)
}

func (s *countingMetadataStore) Stat(ctx context.Context, key string) (storage.ObjectStat, error) {
	s.mu.Lock()
	s.stats++
	s.mu.Unlock()
	return s.Local.Stat(ctx, key)
}

func (s *countingMetadataStore) counts() (opens, stats int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.opens, s.stats
}

type countingOpenStore struct {
	storage.Store

	mu    sync.Mutex
	opens int
}

func (s *countingOpenStore) Open(ctx context.Context, key string) (*os.File, error) {
	s.mu.Lock()
	s.opens++
	s.mu.Unlock()
	return s.Store.Open(ctx, key)
}

func (s *countingOpenStore) openCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.opens
}

func TestStorageObjectSizePrefersMetadataProvider(t *testing.T) {
	ctx := context.Background()
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const key = ".xdrive-blobs/test/metadata"
	payload := bytes.Repeat([]byte{0x7a}, 4096)
	if _, err := local.Put(ctx, key, bytes.NewReader(payload)); err != nil {
		t.Fatal(err)
	}

	store := &countingMetadataStore{Local: local}
	size, err := storageObjectSize(ctx, store, key)
	if err != nil {
		t.Fatal(err)
	}
	if size != int64(len(payload)) {
		t.Fatalf("size=%d want=%d", size, len(payload))
	}
	opens, stats := store.counts()
	if opens != 0 || stats != 1 {
		t.Fatalf("metadata lookup opens=%d stats=%d want opens=0 stats=1", opens, stats)
	}
}

func TestStorageObjectSizeFallsBackToPayloadOpen(t *testing.T) {
	ctx := context.Background()
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const key = ".xdrive-blobs/test/fallback"
	payload := bytes.Repeat([]byte{0x33}, 2048)
	if _, err := local.Put(ctx, key, bytes.NewReader(payload)); err != nil {
		t.Fatal(err)
	}

	store := &countingOpenStore{Store: local}
	size, err := storageObjectSize(ctx, store, key)
	if err != nil {
		t.Fatal(err)
	}
	if size != int64(len(payload)) {
		t.Fatalf("size=%d want=%d", size, len(payload))
	}
	if got := store.openCount(); got != 1 {
		t.Fatalf("fallback payload opens=%d want=1", got)
	}
}

func TestEnsureContentBlobObjectUsesMetadataStatForHealthyTarget(t *testing.T) {
	ctx := context.Background()
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const targetKey = ".xdrive-blobs/test/existing"
	payload := bytes.Repeat([]byte{0x42}, 8192)
	if _, err := local.Put(ctx, targetKey, bytes.NewReader(payload)); err != nil {
		t.Fatal(err)
	}

	store := &countingMetadataStore{Local: local}
	server := &Server{Store: store}
	if err := server.ensureContentBlobObject(ctx, ".xdrive-uploads/missing", targetKey, int64(len(payload))); err != nil {
		t.Fatal(err)
	}
	opens, stats := store.counts()
	if opens != 0 || stats != 1 {
		t.Fatalf("healthy CAS validation opens=%d stats=%d want opens=0 stats=1", opens, stats)
	}
}
