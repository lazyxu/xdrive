package client

import (
	"context"
	"errors"
	"net"
	"os"
	"strings"
)

// ClassifySourceFailure uses typed errors first and avoids claiming a
// specific cause when the transport supplies only an ambiguous message.
func ClassifySourceFailure(err error) string {
	if err == nil {
		return "other"
	}
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		switch apiErr.Status {
		case 429:
			return "rate_limit"
		case 401, 403:
			return "permission"
		case 409, 412:
			return "conflict"
		}
	}
	if errors.Is(err, os.ErrPermission) {
		return "permission"
	}
	var netErr net.Error
	if errors.As(err, &netErr) || errors.Is(err, context.DeadlineExceeded) {
		return "network"
	}
	value := strings.ToLower(err.Error())
	switch {
	case strings.Contains(value, "50005"), strings.Contains(value, "rate limit"),
		strings.Contains(value, "too many requests"), strings.Contains(value, "操作过于频繁"):
		return "rate_limit"
	case strings.Contains(value, "source changed"), strings.Contains(value, "file changed"),
		strings.Contains(value, "changed while hashing"), strings.Contains(value, "changed after hashing"):
		return "file_changed"
	case strings.Contains(value, "connection refused"), strings.Contains(value, "connection reset"),
		strings.Contains(value, "network is unreachable"), strings.Contains(value, "no such host"):
		return "network"
	case strings.Contains(value, "destination already exists"), strings.Contains(value, "revision conflict"):
		return "conflict"
	}
	return "other"
}
