package api

import (
	"bytes"
	"context"
	"io"
	"os"
	"sync"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

type countingUploadPartStore struct {
	storage.Store
	mu    sync.Mutex
	opens map[string]int
}

func (s *countingUploadPartStore) Open(ctx context.Context, key string) (*os.File, error) {
	s.mu.Lock()
	s.opens[key]++
	s.mu.Unlock()
	return s.Store.Open(ctx, key)
}

func (s *countingUploadPartStore) openCount(key string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.opens[key]
}

func TestUploadPartSequenceReusesSourceHandleAcrossStagingPart(t *testing.T) {
	const (
		chunkCount   = 128
		chunkSize    = 32
		changedIndex = 64
	)

	ctx := context.Background()
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	sourceKey := ".xdrive-blobs/test/source"
	stagingKey := storage.UploadStagingDir + "/test/changed"
	source := make([]byte, chunkCount*chunkSize)
	for index := 0; index < chunkCount; index++ {
		for offset := 0; offset < chunkSize; offset++ {
			source[index*chunkSize+offset] = byte(index)
		}
	}
	changed := bytes.Repeat([]byte{0xff}, chunkSize)
	expected := append([]byte(nil), source...)
	copy(expected[changedIndex*chunkSize:(changedIndex+1)*chunkSize], changed)

	if _, err := local.Put(ctx, sourceKey, bytes.NewReader(source)); err != nil {
		t.Fatal(err)
	}
	if _, err := local.Put(ctx, stagingKey, bytes.NewReader(changed)); err != nil {
		t.Fatal(err)
	}

	parts := make([]meta.UploadPart, 0, chunkCount)
	for index := 0; index < chunkCount; index++ {
		if index == changedIndex {
			parts = append(parts, meta.UploadPart{
				PartIndex:  index,
				Size:       chunkSize,
				StorageKey: stagingKey,
			})
			continue
		}
		parts = append(parts, meta.UploadPart{
			PartIndex:        index,
			Size:             chunkSize,
			Reused:           true,
			SourceStorageKey: sourceKey,
			SourceOffset:     int64(index * chunkSize),
		})
	}

	store := &countingUploadPartStore{
		Store: local,
		opens: map[string]int{},
	}
	sequence := &uploadPartSequence{
		ctx:   ctx,
		store: store,
		parts: parts,
	}
	got, err := io.ReadAll(sequence)
	if err != nil {
		t.Fatal(err)
	}
	if err := sequence.Close(); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, expected) {
		t.Fatal("assembled upload differs from expected overwrite bytes")
	}
	if got := store.openCount(sourceKey); got != 1 {
		t.Fatalf("reused source opens=%d want=1", got)
	}
	if got := store.openCount(stagingKey); got != 1 {
		t.Fatalf("changed staging opens=%d want=1", got)
	}
}
