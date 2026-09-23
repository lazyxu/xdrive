//go:build windows

package mount

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows"
)

const (
	winWatchBufferSize   = 64 << 10
	winWatchWaitMillis   = 250
	winLocalDebounce     = 250 * time.Millisecond
	winLocalMaxBatchWait = 2 * time.Second
	winRemotePoll        = 30 * time.Second
	winFullAudit         = 10 * time.Minute
)

type winLocalChange struct {
	Action uint32
	Path   string
}

type winRename struct {
	OldPath string
	NewPath string
}

type winChangeSet struct {
	Renames  []winRename
	Paths    []string
	Overflow bool
}

func watchWindowsChanges(ctx context.Context, root string) (<-chan winLocalChange, <-chan error) {
	changes := make(chan winLocalChange, 4096)
	errs := make(chan error, 1)
	go func() {
		defer close(changes)
		defer close(errs)
		if err := runWindowsWatcher(ctx, root, changes); err != nil && !errors.Is(err, context.Canceled) {
			errs <- err
		}
	}()
	return changes, errs
}

func runWindowsWatcher(ctx context.Context, root string, out chan<- winLocalChange) error {
	rootW, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return err
	}
	handle, err := windows.CreateFile(
		rootW,
		windows.FILE_LIST_DIRECTORY,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OVERLAPPED,
		0,
	)
	if err != nil {
		return fmt.Errorf("open sync root watcher: %w", err)
	}
	defer windows.CloseHandle(handle)

	event, err := windows.CreateEvent(nil, 0, 0, nil)
	if err != nil {
		return fmt.Errorf("create sync watcher event: %w", err)
	}
	defer windows.CloseHandle(event)

	mask := uint32(
		windows.FILE_NOTIFY_CHANGE_FILE_NAME |
			windows.FILE_NOTIFY_CHANGE_DIR_NAME |
			windows.FILE_NOTIFY_CHANGE_SIZE |
			windows.FILE_NOTIFY_CHANGE_LAST_WRITE |
			windows.FILE_NOTIFY_CHANGE_CREATION,
	)
	buffer := make([]byte, winWatchBufferSize)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		overlapped := windows.Overlapped{HEvent: event}
		var ignored uint32
		err := windows.ReadDirectoryChanges(
			handle,
			&buffer[0],
			uint32(len(buffer)),
			true,
			mask,
			&ignored,
			&overlapped,
			0,
		)
		if err != nil && !errors.Is(err, windows.ERROR_IO_PENDING) {
			return fmt.Errorf("ReadDirectoryChangesW: %w", err)
		}

		for {
			if err := ctx.Err(); err != nil {
				_ = windows.CancelIoEx(handle, &overlapped)
				return err
			}
			status, waitErr := windows.WaitForSingleObject(event, winWatchWaitMillis)
			if waitErr != nil {
				_ = windows.CancelIoEx(handle, &overlapped)
				return fmt.Errorf("wait for directory changes: %w", waitErr)
			}
			if status == windows.WAIT_TIMEOUT {
				continue
			}
			if status != windows.WAIT_OBJECT_0 {
				_ = windows.CancelIoEx(handle, &overlapped)
				return fmt.Errorf("wait for directory changes returned status %d", status)
			}
			break
		}

		var n uint32
		if err := windows.GetOverlappedResult(handle, &overlapped, &n, false); err != nil {
			if ctx.Err() != nil || errors.Is(err, windows.ERROR_OPERATION_ABORTED) {
				return ctx.Err()
			}
			return fmt.Errorf("complete directory changes: %w", err)
		}
		if n == 0 {
			out <- winLocalChange{Action: 0}
			continue
		}
		parsed, err := parseWindowsNotifyBuffer(buffer[:n])
		if err != nil {
			out <- winLocalChange{Action: 0}
			continue
		}
		for _, change := range parsed {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case out <- change:
			}
		}
	}
}

func parseWindowsNotifyBuffer(buf []byte) ([]winLocalChange, error) {
	const headerSize = 12
	var out []winLocalChange
	for offset := 0; ; {
		if offset+headerSize > len(buf) {
			return nil, fmt.Errorf("truncated FILE_NOTIFY_INFORMATION header")
		}
		next := int(binary.LittleEndian.Uint32(buf[offset : offset+4]))
		action := binary.LittleEndian.Uint32(buf[offset+4 : offset+8])
		nameBytes := int(binary.LittleEndian.Uint32(buf[offset+8 : offset+12]))
		if nameBytes < 0 || nameBytes%2 != 0 || offset+headerSize+nameBytes > len(buf) {
			return nil, fmt.Errorf("invalid FILE_NOTIFY_INFORMATION filename length")
		}
		u16 := make([]uint16, nameBytes/2)
		for i := range u16 {
			start := offset + headerSize + i*2
			u16[i] = binary.LittleEndian.Uint16(buf[start : start+2])
		}
		name := windows.UTF16ToString(u16)
		if rel, ok := normalizeWindowsChangePath(name); ok {
			out = append(out, winLocalChange{Action: action, Path: rel})
		}
		if next == 0 {
			break
		}
		if next < headerSize || offset+next >= len(buf) {
			return nil, fmt.Errorf("invalid FILE_NOTIFY_INFORMATION next offset")
		}
		offset += next
	}
	return out, nil
}

func normalizeWindowsChangePath(path string) (string, bool) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", false
	}
	path = filepath.ToSlash(filepath.Clean(path))
	if path == "." || path == ".." || strings.HasPrefix(path, "../") || strings.HasPrefix(path, "/") {
		return "", false
	}
	return path, true
}

func collapseWindowsChanges(changes []winLocalChange) winChangeSet {
	var out winChangeSet
	pathSet := make(map[string]struct{})
	var pendingOld string

	addPath := func(path string) {
		if path == "" {
			return
		}
		pathSet[path] = struct{}{}
	}

	for _, change := range changes {
		if change.Action == 0 {
			out.Overflow = true
			continue
		}
		path, ok := normalizeWindowsChangePath(change.Path)
		if !ok {
			continue
		}
		switch change.Action {
		case windows.FILE_ACTION_RENAMED_OLD_NAME:
			if pendingOld != "" {
				addPath(pendingOld)
			}
			pendingOld = path
		case windows.FILE_ACTION_RENAMED_NEW_NAME:
			if pendingOld != "" {
				out.Renames = append(out.Renames, winRename{OldPath: pendingOld, NewPath: path})
				pendingOld = ""
			} else {
				addPath(path)
			}
		default:
			addPath(path)
		}
	}
	if pendingOld != "" {
		addPath(pendingOld)
	}
	for _, rename := range out.Renames {
		delete(pathSet, rename.OldPath)
		delete(pathSet, rename.NewPath)
	}
	out.Paths = make([]string, 0, len(pathSet))
	for path := range pathSet {
		out.Paths = append(out.Paths, path)
	}
	sortPathsByDepth(out.Paths, true)
	return out
}

func sortPathsByDepth(paths []string, parentsFirst bool) {
	sort.Slice(paths, func(i, j int) bool {
		di, dj := depth(paths[i]), depth(paths[j])
		if di == dj {
			return paths[i] < paths[j]
		}
		if parentsFirst {
			return di < dj
		}
		return di > dj
	})
}
