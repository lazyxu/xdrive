package synologyfilesworker

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/pullworker"
	"github.com/lazyxu/xdrive/internal/synology"
)

func TestClassifyPullRetryFileStation(t *testing.T) {
	runner := &Runner{}
	tests := []struct {
		err  error
		want pullworker.RetryClass
	}{
		{fmt.Errorf("wrapped: %w", synology.ErrMultipleLogin), pullworker.RetryRateLimited},
		{&synology.DSMAPIError{Code: 402, Cause: synology.ErrUnavailable}, pullworker.RetryTransient},
		{fmt.Errorf("wrapped: %w", synology.ErrSessionExpired), pullworker.RetryTransient},
		{context.DeadlineExceeded, pullworker.RetryTransient},
		{fmt.Errorf("wrapped: %w", synology.ErrAuthentication), pullworker.RetryNone},
		{fmt.Errorf("wrapped: %w", synology.ErrHTTPForbidden), pullworker.RetryNone},
		{fmt.Errorf("wrapped: %w", synology.ErrPermissionDenied), pullworker.RetryNone},
		{fmt.Errorf("wrapped: %w", synology.ErrFileStationMissing), pullworker.RetryNone},
		{fmt.Errorf("wrapped: %w", synology.ErrFileStationOperation), pullworker.RetryNone},
		{context.Canceled, pullworker.RetryNone},
		{errors.New("deterministic failure"), pullworker.RetryNone},
	}
	for _, tt := range tests {
		if got := runner.ClassifyPullRetry(tt.err); got != tt.want {
			t.Fatalf("ClassifyPullRetry(%v)=%q want=%q", tt.err, got, tt.want)
		}
	}
}

func TestSourceErrorMessageExplainsHTTPForbidden(t *testing.T) {
	got := sourceErrorMessage(fmt.Errorf("wrapped: %w", synology.ErrHTTPForbidden))
	if !strings.Contains(got, "不代表密码错误") || !strings.Contains(got, "HTTP 403") {
		t.Fatalf("message=%q", got)
	}
}
