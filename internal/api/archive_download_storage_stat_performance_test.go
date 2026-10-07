package api

import (
	"context"
	"errors"
	"io"
	"os"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

type archiveStatFastPathStore struct {
	size      int64
	statCalls int
	openCalls int
}

func (s *archiveStatFastPathStore) Put(context.Context, string, io.Reader) (int64, error) {
	return 0, nil
}

func (s *archiveStatFastPathStore) Open(context.Context, string) (*os.File, error) {
	s.openCalls++
	return nil, errors.New("unexpected payload open")
}

func (s *archiveStatFastPathStore) Delete(context.Context, string) error {
	return nil
}

func (s *archiveStatFastPathStore) Stat(context.Context, string) (storage.ObjectStat, error) {
	s.statCalls++
	return storage.ObjectStat{Size: s.size}, nil
}

func TestArchiveStoredFileValidationUsesMetadataStatFastPath(t *testing.T) {
	store := &archiveStatFastPathStore{size: 123}
	server := &Server{Store: store}
	file := meta.File{StorageKey: "blob-key", Size: 123}

	if err := server.validateArchiveStoredFile(context.Background(), file); err != nil {
		t.Fatal(err)
	}
	if store.statCalls != 1 {
		t.Fatalf("stat calls=%d want=1", store.statCalls)
	}
	if store.openCalls != 0 {
		t.Fatalf("payload open calls=%d want=0", store.openCalls)
	}

	store.size = 124
	err := server.validateArchiveStoredFile(context.Background(), file)
	if !errors.Is(err, errArchiveStoredContent) {
		t.Fatalf("size mismatch err=%v want archive stored content error", err)
	}
	if store.statCalls != 2 {
		t.Fatalf("stat calls after mismatch=%d want=2", store.statCalls)
	}
	if store.openCalls != 0 {
		t.Fatalf("payload open calls after mismatch=%d want=0", store.openCalls)
	}
}
