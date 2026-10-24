//go:build windows

package localpush

import (
	"context"
	"errors"

	"golang.org/x/sys/windows"
)

var errNativeRootWatchUnavailable = errors.New("local push native watcher unavailable")

// Windows supports watching an entire directory subtree using one kernel
// handle. Notification is only a hint: the owning Agent still authenticates
// current Source/Device/Root before the same full native inventory scan.
func WatchNativeRootChanges(ctx context.Context, grant RootGrant, notify func()) (func(), error) {
	if ctx == nil || ctx.Err() != nil || notify == nil || !grant.StrongIdentity ||
		VerifyRootGrant(grant) != nil {
		return nil, errNativeRootWatchUnavailable
	}
	const filter = windows.FILE_NOTIFY_CHANGE_FILE_NAME |
		windows.FILE_NOTIFY_CHANGE_DIR_NAME |
		windows.FILE_NOTIFY_CHANGE_LAST_WRITE |
		windows.FILE_NOTIFY_CHANGE_SIZE |
		windows.FILE_NOTIFY_CHANGE_ATTRIBUTES
	handle, err := windows.FindFirstChangeNotification(grant.Path, true, filter)
	if err != nil {
		return nil, errNativeRootWatchUnavailable
	}
	watchCtx, cancel := context.WithCancel(ctx)
	go func() {
		defer windows.FindCloseChangeNotification(handle)
		for {
			if watchCtx.Err() != nil {
				return
			}
			status, waitErr := windows.WaitForSingleObject(handle, 500)
			if waitErr != nil {
				notify()
				return
			}
			if status == uint32(windows.WAIT_TIMEOUT) {
				continue
			}
			if status != windows.WAIT_OBJECT_0 || VerifyRootGrant(grant) != nil {
				notify()
				return // watcher lost coverage or Root identity changed
			}
			notify()
			if err := windows.FindNextChangeNotification(handle); err != nil {
				notify()
				return
			}
		}
	}()
	return cancel, nil
}
