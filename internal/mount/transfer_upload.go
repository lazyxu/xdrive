package mount

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/transfer"
)

func uploadTransferContext(ctx context.Context, handle *transfer.Handle) context.Context {
	if handle == nil {
		return ctx
	}
	return client.WithUploadNetworkProgress(ctx, handle.NetworkProgressObserver())
}
