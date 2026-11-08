package api

// The Host install.lock is authoritative for the worker. The host installer
// additionally publishes a read-only marker in the package mount so already
// authenticated client HTTP downloads can stop sending bytes during Server
// dependency transfers without granting Docker/Host privileges to the API.
import (
	"context"
	"errors"
	"io"
	"os"
	"time"
)

// releaseBundlePausedReader is a ReadSeeker so net/http ServeContent keeps
// normal Range/206/HEAD handling. Each body read checks the Host pause marker;
// when absent no delay, bandwidth ceiling or change to the read path exists.
type releaseBundlePausedReader struct {
	src    io.ReadSeeker
	ctx    context.Context
	marker string
}

func waitReleaseBundleDependencyLane(ctx context.Context, marker string) error {
	for {
		_, err := os.Lstat(marker)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			// Fail closed rather than serving package bytes when the shared
			// Host status is unreadable for a reason other than nonexistence.
			return err
		}
		timer := time.NewTimer(200 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func (r releaseBundlePausedReader) Read(out []byte) (int, error) {
	if err := waitReleaseBundleDependencyLane(r.ctx, r.marker); err != nil {
		return 0, err
	}
	return r.src.Read(out)
}

func (r releaseBundlePausedReader) Seek(offset int64, whence int) (int64, error) {
	return r.src.Seek(offset, whence)
}
