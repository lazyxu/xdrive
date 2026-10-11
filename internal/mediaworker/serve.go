package mediaworker

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// ServeUnix binds exclusively to a provisioned private Unix directory.
// It refuses to remove regular files, symlinks or a live listener.
func ServeUnix(ctx context.Context, socket string, probe Prober) error {
	if err := ValidateSocket(socket); err != nil {
		return err
	}
	parent, err := os.Lstat(filepath.Dir(socket))
	if err != nil || !parent.IsDir() || parent.Mode()&os.ModeSymlink != 0 ||
		parent.Mode().Perm()&0002 != 0 {
		return errors.New("media worker private socket directory not safely provisioned")
	}
	if existing, err := os.Lstat(socket); err == nil {
		if existing.Mode()&os.ModeSocket == 0 || existing.Mode()&os.ModeSymlink != 0 {
			return errors.New("refusing to overwrite non-socket media worker entry")
		}
		if conn, dialErr := net.DialTimeout("unix", socket, 150*time.Millisecond); dialErr == nil {
			_ = conn.Close()
			return errors.New("media worker socket is already active")
		}
		if err := os.Remove(socket); err != nil {
			return errors.New("cannot remove stale media worker socket")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return errors.New("cannot verify media worker socket")
	}
	if probe == nil {
		probe = ProbeFunc(LiveInfo)
	}
	if _, err := probe.Info(ctx); err != nil {
		return errors.New("FFmpeg and FFprobe are not verified")
	}
	listener, err := net.Listen("unix", socket)
	if err != nil {
		return err
	}
	if unix, ok := listener.(*net.UnixListener); ok {
		unix.SetUnlinkOnClose(false)
	}
	if err := os.Chmod(socket, 0600); err != nil {
		_ = listener.Close()
		return err
	}
	owned, err := os.Lstat(socket)
	if err != nil {
		_ = listener.Close()
		return err
	}
	defer func() {
		_ = listener.Close()
		if actual, err := os.Lstat(socket); err == nil && os.SameFile(owned, actual) {
			_ = os.Remove(socket)
		}
	}()
	server := &http.Server{Handler: Handler(probe), ReadHeaderTimeout: time.Second}
	finished := make(chan error, 1)
	go func() { finished <- server.Serve(listener) }()
	select {
	case <-ctx.Done():
		done, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(done)
		<-finished
		return nil
	case err := <-finished:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
