package synologysync

import (
	"context"
	"io"

	"github.com/lazyxu/xdrive/internal/pullsync"
	"github.com/lazyxu/xdrive/internal/synology"
)

type DownloadRemote interface {
	OpenItem(context.Context, synology.Item, int64) (io.ReadCloser, error)
}

type ExecutionAPI = pullsync.ExecutionAPI

type Executor struct {
	*pullsync.Executor[TransferRef]
}

func NewExecutor(remote DownloadRemote, api ExecutionAPI, targetNodeID uint64) *Executor {
	return &Executor{Executor: pullsync.NewExecutor(
		api,
		targetNodeID,
		"synology",
		func(ctx context.Context, ref TransferRef, offset int64) (io.ReadCloser, error) {
			return remote.OpenItem(ctx, ref.Item, offset)
		},
		nil,
	)}
}
