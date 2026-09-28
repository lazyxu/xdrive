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

type capacityTestStore struct {
	capacity storage.Capacity
}

func (s capacityTestStore) Put(context.Context, string, io.Reader) (int64, error) { return 0, nil }
func (s capacityTestStore) Open(context.Context, string) (*os.File, error) {
	return nil, os.ErrNotExist
}
func (s capacityTestStore) Delete(context.Context, string) error { return nil }
func (s capacityTestStore) Capacity(context.Context) (storage.Capacity, error) {
	return s.capacity, nil
}

func TestEffectiveAvailableBytes(t *testing.T) {
	tests := []struct {
		name  string
		quota int64
		used  int64
		disk  int64
		want  int64
	}{
		{name: "unlimited follows disk", quota: 0, used: 900, disk: 500, want: 500},
		{name: "quota remaining wins", quota: 1000, used: 400, disk: 2000, want: 600},
		{name: "disk remaining wins", quota: 1000, used: 400, disk: 250, want: 250},
		{name: "over quota is zero", quota: 1000, used: 1200, disk: 500, want: 0},
		{name: "negative disk clamps", quota: 0, used: 0, disk: -1, want: 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := effectiveAvailableBytes(tc.quota, tc.used, tc.disk); got != tc.want {
				t.Fatalf("effective available=%d want=%d", got, tc.want)
			}
		})
	}
}

func TestEnsureStorageWriteCapacity(t *testing.T) {
	server := &Server{Store: capacityTestStore{capacity: storage.Capacity{
		TotalBytes: 1000, AvailableBytes: 400,
	}}}
	if err := server.ensureStorageWriteCapacity(context.Background(), 400); err != nil {
		t.Fatalf("exact available capacity was rejected: %v", err)
	}
	err := server.ensureStorageWriteCapacity(context.Background(), 401)
	var capacityErr *storageCapacityExceededError
	if !errors.As(err, &capacityErr) {
		t.Fatalf("error=%v want storageCapacityExceededError", err)
	}
	if capacityErr.RequiredBytes != 401 || capacityErr.AvailableBytes != 400 {
		t.Fatalf("capacity error=%+v", capacityErr)
	}
}

func TestResumableUploadRemainingPeakBytes(t *testing.T) {
	tests := []struct {
		name     string
		total    int64
		received []meta.UploadPart
		want     int64
	}{
		{name: "empty", total: 0, want: 0},
		{name: "new upload needs staging plus assembly", total: 100, want: 200},
		{name: "partial resume subtracts received chunks", total: 100, received: []meta.UploadPart{{Size: 40}}, want: 160},
		{name: "reused chunks count as already available", total: 100, received: []meta.UploadPart{{Size: 40, Reused: true}, {Size: 20, Reused: true}}, want: 140},
		{name: "fully received only needs assembly", total: 100, received: []meta.UploadPart{{Size: 100}}, want: 100},
		{name: "oversized received data clamps", total: 100, received: []meta.UploadPart{{Size: 120}}, want: 100},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := resumableUploadRemainingPeakBytes(tc.total, tc.received); got != tc.want {
				t.Fatalf("peak bytes=%d want=%d", got, tc.want)
			}
		})
	}
}
