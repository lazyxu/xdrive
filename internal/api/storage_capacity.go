package api

import (
	"context"
	"fmt"

	"github.com/lazyxu/xdrive/internal/storage"
)

func (s *Server) storageCapacity(ctx context.Context) (storage.Capacity, error) {
	reporter, ok := s.Store.(storage.CapacityReporter)
	if !ok {
		return storage.Capacity{}, fmt.Errorf("storage backend does not report filesystem capacity")
	}
	capacity, err := reporter.Capacity(ctx)
	if err != nil {
		return storage.Capacity{}, err
	}
	if capacity.TotalBytes < 0 || capacity.AvailableBytes < 0 || capacity.AvailableBytes > capacity.TotalBytes {
		return storage.Capacity{}, fmt.Errorf("storage backend returned invalid capacity")
	}
	return capacity, nil
}

func effectiveAvailableBytes(quotaBytes, usedBytes, diskAvailableBytes int64) int64 {
	if diskAvailableBytes < 0 {
		diskAvailableBytes = 0
	}
	if quotaBytes <= 0 {
		return diskAvailableBytes
	}
	remaining := quotaBytes - usedBytes
	if remaining < 0 {
		remaining = 0
	}
	if remaining < diskAvailableBytes {
		return remaining
	}
	return diskAvailableBytes
}
