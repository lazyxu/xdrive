package client

import (
	"context"
	"testing"
)

func TestFileQuickAccessClientSurface(t *testing.T) {
	var _ func(*Client, context.Context) ([]FileQuickAccessItem, error) = (*Client).FileQuickAccess
	var _ func(*Client, context.Context, uint64) (FileQuickAccessItem, error) = (*Client).PinFileQuickAccess
	var _ func(*Client, context.Context, uint64) error = (*Client).UnpinFileQuickAccess
}
