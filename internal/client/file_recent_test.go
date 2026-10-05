package client

import (
	"context"
	"testing"
)

func TestFileRecentClientSurface(t *testing.T) {
	var _ func(*Client, context.Context, int) ([]FileRecentItem, error) = (*Client).FileRecent
	var _ func(*Client, context.Context, uint64) (FileRecentItem, error) = (*Client).TouchFileRecent
	var _ func(*Client, context.Context) error = (*Client).ClearFileRecent
}
