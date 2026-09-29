package yikesync

import (
	"context"
	"io"

	"github.com/lazyxu/xdrive/internal/pullsync"
	"github.com/lazyxu/xdrive/internal/yike"
)

type DownloadRemote interface {
	DownloadFileLink(context.Context, int64) (yike.DownloadLink, error)
	DownloadAlbumFileLink(context.Context, int64, yike.AlbumFile) (yike.DownloadLink, error)
	OpenDownload(context.Context, yike.DownloadLink, int64) (io.ReadCloser, error)
}

type ExecutionAPI = pullsync.ExecutionAPI

type TransferRef struct {
	OwnUK     int64
	OwnerUK   int64
	File      yike.File
	AlbumFile *yike.AlbumFile
}

type Executor struct {
	*pullsync.Executor[TransferRef]
}

func NewExecutor(remote DownloadRemote, api ExecutionAPI, targetNodeID uint64) *Executor {
	return &Executor{Executor: pullsync.NewExecutor(
		api,
		targetNodeID,
		"yike",
		func(ctx context.Context, ref TransferRef, offset int64) (io.ReadCloser, error) {
			var (
				link yike.DownloadLink
				err  error
			)
			if ref.AlbumFile != nil {
				link, err = remote.DownloadAlbumFileLink(ctx, ref.OwnUK, *ref.AlbumFile)
			} else {
				link, err = remote.DownloadFileLink(ctx, ref.File.FSID)
			}
			if err != nil {
				return nil, err
			}
			return remote.OpenDownload(ctx, link, offset)
		},
		func(ref TransferRef) string {
			return metadataMD5(ref.File.MD5)
		},
	)}
}
