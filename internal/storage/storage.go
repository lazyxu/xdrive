package storage

import (
	"context"
	"io"
	"os"
)

type Store interface {
	Put(ctx context.Context, key string, r io.Reader) (int64, error)
	Open(ctx context.Context, key string) (*os.File, error)
	Delete(ctx context.Context, key string) error
}
