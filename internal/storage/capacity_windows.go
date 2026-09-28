//go:build windows

package storage

import (
	"context"

	"golang.org/x/sys/windows"
)

func (l *Local) Capacity(ctx context.Context) (Capacity, error) {
	if err := ctx.Err(); err != nil {
		return Capacity{}, err
	}
	root, err := windows.UTF16PtrFromString(l.root)
	if err != nil {
		return Capacity{}, err
	}
	var available, total, free uint64
	if err := windows.GetDiskFreeSpaceEx(root, &available, &total, &free); err != nil {
		return Capacity{}, err
	}
	return Capacity{
		TotalBytes:     int64(total),
		AvailableBytes: int64(available),
	}, nil
}
