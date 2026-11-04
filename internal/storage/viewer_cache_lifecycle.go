package storage

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ViewerCacheLifecycleLockFile holds a fixed cross-process lock for
// generated still previews only. Do not remove/rename it during cache GC.
// Shared readers and a nonblocking exclusive evictor use the same inode,
// independently of the existing CAS and atomic-write lifecycle locks.
const ViewerCacheLifecycleLockFile = ".xdrive-viewer-cache-lifecycle.lock"

func (l *Local) viewerCacheLifecycleLease(
	ctx context.Context, exclusive, try bool,
) (release func(), acquired bool, err error) {
	if l == nil || l.root == "" {
		return nil, false, errors.New("Viewer cache storage root unavailable")
	}
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	f, err := os.OpenFile(filepath.Join(l.root, ViewerCacheLifecycleLockFile),
		os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, false, err
	}
	acquired, err = lockTempLifecycleFile(ctx, f, exclusive, try)
	if err != nil || !acquired {
		_ = f.Close()
		return nil, false, err
	}
	return func() {
		_ = unlockTempLifecycleFile(f)
		_ = f.Close()
	}, true, nil
}

// OpenPinnedViewerCache acquires its shared lease BEFORE opening any Viewer
// bytes. A cache GC holding the exclusive lease cannot race that open. The
// caller closes the image file, THEN invokes the returned release function.
func (l *Local) OpenPinnedViewerCache(ctx context.Context, key string) (*os.File, func(), error) {
	if !strings.HasPrefix(key, ".xdrive-media/thumbnails/") ||
		!strings.Contains(key, "-v101-") ||
		(!strings.HasSuffix(key, ".jpg") && !strings.HasSuffix(key, ".webp")) {
		return nil, nil, fmt.Errorf("Viewer cache read requires generated preview key")
	}
	release, acquired, err := l.viewerCacheLifecycleLease(ctx, false, false)
	if err != nil {
		return nil, nil, err
	}
	if !acquired {
		return nil, nil, errors.New("Viewer cache read lease unavailable")
	}
	file, err := l.Open(ctx, key)
	if err != nil {
		release()
		return nil, nil, err
	}
	return file, release, nil
}

// TryExclusiveViewerCacheEviction never waits behind foreground Viewer reads;
// its caller must skip rather than block playback and still-image rendering.
func (l *Local) TryExclusiveViewerCacheEviction(ctx context.Context) (func(), bool, error) {
	return l.viewerCacheLifecycleLease(ctx, true, true)
}
