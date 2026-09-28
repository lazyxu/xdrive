//go:build linux

package storage

import (
	"context"

	"golang.org/x/sys/unix"
)

func (l *Local) Capacity(ctx context.Context) (Capacity, error) {
	if err := ctx.Err(); err != nil {
		return Capacity{}, err
	}
	var stat unix.Statfs_t
	if err := unix.Statfs(l.root, &stat); err != nil {
		return Capacity{}, err
	}
	blockSize := uint64(stat.Bsize)
	return Capacity{
		TotalBytes:     int64(stat.Blocks * blockSize),
		AvailableBytes: int64(stat.Bavail * blockSize),
	}, nil
}
