//go:build !linux && !windows

package storage

import (
	"context"
	"fmt"
)

func (l *Local) Capacity(ctx context.Context) (Capacity, error) {
	if err := ctx.Err(); err != nil {
		return Capacity{}, err
	}
	return Capacity{}, fmt.Errorf("storage capacity reporting is unsupported on this platform")
}
