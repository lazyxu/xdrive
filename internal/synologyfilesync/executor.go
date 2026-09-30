package synologyfilesync

import (
	"context"
	"io"

	"github.com/lazyxu/xdrive/internal/pullsync"
)

type DownloadRemote interface {
	OpenPath(context.Context, string, int64) (io.ReadCloser, error)
}

type ExecutionAPI = pullsync.ExecutionAPI

type Executor struct {
	*pullsync.Executor[TransferRef]
}

func NewExecutor(remote DownloadRemote, api ExecutionAPI, targetNodeID uint64) *Executor {
	return &Executor{Executor: pullsync.NewExecutor(
		api,
		targetNodeID,
		"synology-files",
		func(ctx context.Context, ref TransferRef, offset int64) (io.ReadCloser, error) {
			return remote.OpenPath(ctx, ref.RemotePath, offset)
		},
		nil,
	)}
}
