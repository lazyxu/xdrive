package storage

import (
	"context"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"
)

const ContentBlobDir = ".xdrive-blobs"

func ContentAddressedKey(sha256 string) (string, error) {
	hash := strings.ToLower(strings.TrimSpace(sha256))
	if len(hash) != 64 {
		return "", fmt.Errorf("invalid sha256")
	}
	if _, err := hex.DecodeString(hash); err != nil {
		return "", fmt.Errorf("invalid sha256")
	}
	return ContentBlobDir + "/sha256/" + hash[:2] + "/" + hash, nil
}

func IsContentAddressedKey(key string) bool {
	_, ok := ContentHashFromKey(key)
	return ok
}

func ContentHashFromKey(key string) (string, bool) {
	key = strings.TrimSpace(key)
	prefix := ContentBlobDir + "/sha256/"
	if !strings.HasPrefix(key, prefix) {
		return "", false
	}
	parts := strings.Split(strings.TrimPrefix(key, prefix), "/")
	if len(parts) != 2 || len(parts[0]) != 2 || len(parts[1]) != 64 || parts[0] != parts[1][:2] {
		return "", false
	}
	hash := strings.ToLower(parts[1])
	if _, err := hex.DecodeString(hash); err != nil {
		return "", false
	}
	return hash, true
}

type Store interface {
	Put(ctx context.Context, key string, r io.Reader) (int64, error)
	Open(ctx context.Context, key string) (*os.File, error)
	Delete(ctx context.Context, key string) error
}
