//go:build linux

package localpush

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/unix"
)

const nativeRootWatchMaxDirectories = 2048

var errNativeRootWatchUnavailable = errors.New("local push native watcher unavailable")

// WatchNativeRootChanges emits only advisory, coalescible wake-ups. It never
// supplies an inventory snapshot, a deletion inference or an upload grant.
// An oversized, inaccessible or uncertain directory tree falls back to the
// existing periodic full verified scan; no partial watch is treated as proof.
func WatchNativeRootChanges(ctx context.Context, grant RootGrant, notify func()) (func(), error) {
	if ctx == nil || ctx.Err() != nil || notify == nil || !grant.StrongIdentity ||
		VerifyRootGrant(grant) != nil {
		return nil, errNativeRootWatchUnavailable
	}
	fd, err := unix.InotifyInit1(unix.IN_NONBLOCK | unix.IN_CLOEXEC)
	if err != nil {
		return nil, errNativeRootWatchUnavailable
	}
	const events = unix.IN_CREATE | unix.IN_DELETE | unix.IN_MODIFY |
		unix.IN_ATTRIB | unix.IN_MOVED_FROM | unix.IN_MOVED_TO |
		unix.IN_CLOSE_WRITE | unix.IN_DELETE_SELF | unix.IN_MOVE_SELF
	const watchFlags = events | unix.IN_ONLYDIR | unix.IN_DONT_FOLLOW
	directories := make(map[string]struct{})
	byDescriptor := make(map[int]string)
	// A bounded initial walk avoids consuming unlimited inotify descriptors
	// or delaying ordinary scheduled backup on large (e.g. 100k) sources.
	setupDeadline := time.Now().Add(3 * time.Second)
	addTree := func(root string) error {
		// Streaming ReadDir avoids the O(100k) memory allocation of
		// filepath.WalkDir for a very wide local directory.
		pending := []string{root}
		for len(pending) != 0 {
			if err := ctx.Err(); err != nil {
				return err
			}
			if time.Now().After(setupDeadline) {
				return errNativeRootWatchUnavailable
			}
			directory := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			info, err := os.Lstat(directory)
			if err != nil {
				return err
			}
			if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				continue
			}
			relative, err := filepath.Rel(grant.Path, directory)
			if err != nil || relative == ".." ||
				strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
				return errNativeRootWatchUnavailable
			}
			if _, already := directories[directory]; already {
				continue
			}
			if len(directories) >= nativeRootWatchMaxDirectories {
				return errNativeRootWatchUnavailable
			}
			id, err := unix.InotifyAddWatch(fd, directory, uint32(watchFlags))
			if err != nil {
				return err
			}
			directories[directory] = struct{}{}
			byDescriptor[id] = directory
			f, err := os.Open(directory)
			if err != nil {
				return err
			}
			for {
				entries, readErr := f.ReadDir(256)
				for _, entry := range entries {
					if entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
						pending = append(pending, filepath.Join(directory, entry.Name()))
						if len(pending)+len(directories) > nativeRootWatchMaxDirectories {
							_ = f.Close()
							return errNativeRootWatchUnavailable
						}
					}
				}
				if readErr == io.EOF {
					break
				}
				if readErr != nil || len(entries) == 0 ||
					time.Now().After(setupDeadline) || ctx.Err() != nil {
					_ = f.Close()
					return errNativeRootWatchUnavailable
				}
			}
			if err := f.Close(); err != nil {
				return err
			}
		}
		return nil
	}
	if err := addTree(grant.Path); err != nil {
		_ = unix.Close(fd)
		return nil, errNativeRootWatchUnavailable
	}
	watchCtx, cancel := context.WithCancel(ctx)
	go func() {
		defer unix.Close(fd)
		buffer := make([]byte, 64<<10)
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for {
			if watchCtx.Err() != nil {
				return
			}
			n, err := unix.Read(fd, buffer)
			if err == unix.EINTR || err == unix.EAGAIN {
				select {
				case <-watchCtx.Done():
					return
				case <-ticker.C:
					continue
				}
			}
			if err != nil || n == 0 {
				notify() // lost watcher coverage: the scheduler must reconcile
				return
			}
			for offset := 0; offset+unix.SizeofInotifyEvent <= n; {
				event := (*unix.InotifyEvent)(unsafe.Pointer(&buffer[offset]))
				end := offset + unix.SizeofInotifyEvent + int(event.Len)
				if end > n || end <= offset {
					notify()
					return
				}
				name := string(bytes.TrimRight(buffer[offset+unix.SizeofInotifyEvent:end], "\x00"))
				if event.Mask&unix.IN_IGNORED != 0 {
					if directory, exists := byDescriptor[int(event.Wd)]; exists {
						delete(directories, directory)
						delete(byDescriptor, int(event.Wd))
					}
				}
				if event.Mask&unix.IN_Q_OVERFLOW != 0 {
					notify()
					return // never use incomplete event coverage as evidence
				}
				if event.Mask&events != 0 {
					notify()
				}
				if event.Mask&(unix.IN_CREATE|unix.IN_MOVED_TO) != 0 &&
					event.Mask&unix.IN_ISDIR != 0 && name != "" &&
					name != "." && name != ".." && !strings.ContainsAny(name, "/\\") {
					if parent := byDescriptor[int(event.Wd)]; parent != "" {
						child := filepath.Join(parent, name)
						info, statErr := os.Lstat(child)
						if statErr == nil && info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
							setupDeadline = time.Now().Add(3 * time.Second)
							if addTree(child) != nil {
								notify()
								return // periodic full reconcile remains authoritative
							}
						}
					}
				}
				offset = end
			}
			// Root revocation or changed OS identity cannot enable an upload.
			// Drop this watcher and leave next scheduled scan to reauthorize.
			if VerifyRootGrant(grant) != nil {
				notify()
				return
			}
		}
	}()
	return cancel, nil
}
