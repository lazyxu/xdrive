package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
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

type storageCapacityExceededError struct {
	RequiredBytes  int64
	AvailableBytes int64
}

func (e *storageCapacityExceededError) Error() string { return "storage capacity exceeded" }

func (s *Server) ensureStorageWriteCapacity(ctx context.Context, requiredBytes int64) error {
	if requiredBytes <= 0 {
		return nil
	}
	if _, ok := s.Store.(storage.CapacityReporter); !ok {
		return nil
	}
	capacity, err := s.storageCapacity(ctx)
	if err != nil {
		return err
	}
	if requiredBytes > capacity.AvailableBytes {
		return &storageCapacityExceededError{
			RequiredBytes: requiredBytes, AvailableBytes: capacity.AvailableBytes,
		}
	}
	return nil
}

func writeStorageCapacityError(c *gin.Context, err error) bool {
	var capacityErr *storageCapacityExceededError
	if !errors.As(err, &capacityErr) {
		return false
	}
	c.AbortWithStatusJSON(http.StatusInsufficientStorage, gin.H{
		"error":           "storage_capacity_exceeded",
		"required_bytes":  capacityErr.RequiredBytes,
		"available_bytes": capacityErr.AvailableBytes,
	})
	return true
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
