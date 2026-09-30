package synologyworker

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"testing"

	"github.com/lazyxu/xdrive/internal/pullworker"
	"github.com/lazyxu/xdrive/internal/synology"
)

func TestClassifyPullRetrySynology(t *testing.T) {
	runner := &Runner{}
	tlsHostname := x509.HostnameError{Certificate: &x509.Certificate{}, Host: "nas.invalid"}
	tests := []struct {
		err  error
		want pullworker.RetryClass
	}{
		{fmt.Errorf("wrapped: %w", synology.ErrMultipleLogin), pullworker.RetryRateLimited},
		{fmt.Errorf("wrapped: %w", synology.ErrUnavailable), pullworker.RetryTransient},
		{fmt.Errorf("wrapped: %w", synology.ErrSessionExpired), pullworker.RetryTransient},
		{context.DeadlineExceeded, pullworker.RetryTransient},
		{fmt.Errorf("wrapped: %w", synology.ErrAuthentication), pullworker.RetryNone},
		{fmt.Errorf("wrapped: %w", synology.ErrPermissionDenied), pullworker.RetryNone},
		{fmt.Errorf("wrapped: %w", synology.ErrOTPRequired), pullworker.RetryNone},
		{fmt.Errorf("wrapped: %w", synology.ErrPhotosMissing), pullworker.RetryNone},
		{fmt.Errorf("%w: %w", synology.ErrUnavailable, tlsHostname), pullworker.RetryNone},
		{&synology.DSMAPIError{Code: 999, Cause: synology.ErrUnavailable}, pullworker.RetryNone},
		{context.Canceled, pullworker.RetryNone},
		{errors.New("deterministic failure"), pullworker.RetryNone},
	}
	for _, tt := range tests {
		if got := runner.ClassifyPullRetry(tt.err); got != tt.want {
			t.Fatalf("ClassifyPullRetry(%v)=%q want=%q", tt.err, got, tt.want)
		}
	}
}
