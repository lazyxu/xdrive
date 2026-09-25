//go:build windows

package mount

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/transfer"
)

func (p *winProvider) startTransfer(kind, direction, path string, total int64, retry transfer.RetryFunc) *transfer.Handle {
	if p == nil || p.transfers == nil {
		return nil
	}
	name := filepath.Base(filepath.Clean(path))
	if name == "." || name == string(filepath.Separator) || strings.TrimSpace(name) == "" {
		name = path
	}
	return p.transfers.Start(transfer.Spec{
		FileName:   name,
		Path:       filepath.ToSlash(path),
		Kind:       kind,
		Direction:  direction,
		TotalBytes: total,
		Retry:      retry,
	})
}

func (p *winProvider) uploadTransfer(path string, total int64) (*transfer.Handle, client.UploadProgress) {
	h := p.startTransfer(transfer.KindUpload, "upload", path, total, p.retryTransfer)
	if h == nil {
		return nil, nil
	}
	first := true
	return h, func(done, total int64) {
		if first {
			first = false
			h.Baseline(done, total)
			return
		}
		h.Progress(done, total)
	}
}

func finishTransfer(h *transfer.Handle, err error) {
	if h == nil {
		return
	}
	if err != nil {
		h.Fail(err)
		return
	}
	h.Complete()
}

func (p *winProvider) retryTransfer(ctx context.Context) error {
	if p == nil {
		return errors.New("Windows sync provider is unavailable")
	}
	activeWinProvider.RLock()
	active := activeWinProvider.p
	activeWinProvider.RUnlock()
	if active != p {
		return errors.New("Windows sync provider is no longer active")
	}
	result := make(chan error, 1)
	select {
	case p.retrySync <- result:
	case <-ctx.Done():
		return ctx.Err()
	}
	select {
	case err := <-result:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func activeWinTransfers() *transfer.Manager {
	activeWinProvider.RLock()
	p := activeWinProvider.p
	activeWinProvider.RUnlock()
	if p == nil {
		return nil
	}
	return p.transfers
}

func startDehydrationTransfer(path string) *transfer.Handle {
	manager := activeWinTransfers()
	if manager == nil {
		return nil
	}
	var total int64
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		total = info.Size()
	}
	name := filepath.Base(filepath.Clean(path))
	return manager.Start(transfer.Spec{
		FileName:   name,
		Path:       filepath.ToSlash(path),
		Kind:       transfer.KindDehydration,
		Direction:  "local",
		TotalBytes: total,
	})
}
