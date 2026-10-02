package client

import (
	"context"
	"testing"
)

func TestFileOperationClientSurface(t *testing.T) {
	var _ func(*Client, context.Context, string, []BatchNodeRef, uint64) (FileOperation, error) = (*Client).CreateFileOperation
	var _ func(*Client, context.Context, int) ([]FileOperation, error) = (*Client).ListFileOperations
	var _ func(*Client, context.Context) error = (*Client).ClearFileOperationHistory
	var _ func(*Client, context.Context, string) (FileOperation, error) = (*Client).GetFileOperation
	var _ func(*Client, context.Context, string) (FileOperation, error) = (*Client).CancelFileOperation
	var _ func(*Client, context.Context, string) (FileOperation, error) = (*Client).RetryFileOperation
}
