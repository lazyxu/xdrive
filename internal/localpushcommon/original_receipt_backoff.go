package localpushcommon

import (
	"context"
	"errors"
	"io"
	"net"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

// Only the original immutable per-file SQL receipt may prove COMMIT.
// Re-read is safe against lost response bytes: it does not admit a new
// Operation, open a local file, bind, chunk, finalize, or infer cancellation.
// Never retry Owner/Root ACL denials, malformed replies or protocol conflicts.
const originalReceiptReadAttempts = 3

func retryableOriginalReceiptReadError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) ||
		errors.Is(err, net.ErrClosed) {
		return true
	}
	var networkErr net.Error
	return errors.As(err, &networkErr) &&
		(networkErr.Timeout() || networkErr.Temporary())
}

// ReadOriginalReceiptWithBackoff retries only transient transport read errors
// with a bounded delay and current context. It never supplies synthetic proof.
// The caller must still compare the returned receipt to the persisted Plan.
func ReadOriginalReceiptWithBackoff(
	ctx context.Context,
	read func() (client.LocalPushCommonUploadReceipt, error),
) (client.LocalPushCommonUploadReceipt, error) {
	var zero client.LocalPushCommonUploadReceipt
	if ctx == nil || read == nil {
		return zero, ErrUncertain
	}
	for attempt := 0; attempt < originalReceiptReadAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return zero, err
		}
		value, err := read()
		if err == nil {
			return value, nil
		}
		if !retryableOriginalReceiptReadError(err) ||
			attempt+1 == originalReceiptReadAttempts {
			return zero, err
		}
		delay := time.Duration(attempt+1) * 250 * time.Millisecond
		select {
		case <-ctx.Done():
			return zero, ctx.Err()
		case <-time.After(delay):
		}
	}
	return zero, ErrUncertain
}
