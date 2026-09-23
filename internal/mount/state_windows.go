//go:build windows

package mount

import (
	"fmt"
	"io/fs"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

const (
	cfPinStatePinned   = 1
	cfPinStateUnpinned = 2
	cfSetPinRecurse    = 0x00000001
	cfEOF              = ^uintptr(0)

	fileAttrOffline            = 0x00001000
	fileAttrRecallOnOpen       = 0x00040000
	fileAttrPinned             = 0x00080000
	fileAttrUnpinned           = 0x00100000
	fileAttrRecallOnDataAccess = 0x00400000
)

func keepLocalPlatform(path string) error {
	path = filepath.Clean(path)
	if err := setPinPath(path, cfPinStatePinned, true); err != nil {
		return err
	}
	return walkCloudFiles(path, func(file string) error {
		return hydratePath(file)
	})
}

func releaseSpacePlatform(path string) error {
	return makeOnlineOnly(path)
}

func onlineOnlyPlatform(path string) error {
	return makeOnlineOnly(path)
}

func makeOnlineOnly(path string) error {
	path = filepath.Clean(path)
	if err := setPinPath(path, cfPinStateUnpinned, true); err != nil {
		return err
	}
	var firstErr error
	err := walkCloudFiles(path, func(file string) error {
		if err := dehydratePath(file); err != nil && firstErr == nil {
			firstErr = err
		}
		return nil
	})
	if err != nil {
		return err
	}
	return firstErr
}

func availabilityPlatform(path string) (FileAvailability, error) {
	path = filepath.Clean(path)
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return FileAvailability{}, err
	}
	attrs, err := windows.GetFileAttributes(p)
	if err != nil {
		return FileAvailability{}, err
	}
	pinned := attrs&fileAttrPinned != 0
	unpinned := attrs&fileAttrUnpinned != 0
	recall := attrs&(fileAttrOffline|fileAttrRecallOnOpen|fileAttrRecallOnDataAccess) != 0
	placeholder := pinned || unpinned || recall
	onlineOnly := unpinned && recall
	mode := "local"
	switch {
	case pinned:
		mode = "always-local"
	case onlineOnly:
		mode = "online-only"
	case recall:
		mode = "cloud"
	case placeholder:
		mode = "local"
	}
	return FileAvailability{
		Path:             path,
		Mode:             mode,
		Placeholder:      placeholder,
		Pinned:           pinned,
		OnlineOnly:       onlineOnly,
		AvailableOffline: !recall,
	}, nil
}

func setPinPath(path string, state uint32, recurse bool) error {
	h, isDir, err := openCloudPath(path)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(h)
	flags := uintptr(0)
	if recurse && isDir {
		flags = cfSetPinRecurse
	}
	hr, _, _ := procSetPinState.Call(uintptr(h), uintptr(state), flags, 0)
	return hresult("CfSetPinState", hr)
}

func hydratePath(path string) error {
	h, isDir, err := openCloudPath(path)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(h)
	if isDir {
		return nil
	}
	hr, _, _ := procHydratePlaceholder.Call(uintptr(h), 0, cfEOF, 0, 0)
	return hresult("CfHydratePlaceholder", hr)
}

func dehydratePath(path string) error {
	h, isDir, err := openCloudPath(path)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(h)
	if isDir {
		return nil
	}
	hr, _, _ := procDehydratePlaceholder.Call(uintptr(h), 0, cfEOF, 0, 0)
	return hresult("CfDehydratePlaceholder", hr)
}

func openCloudPath(path string) (windows.Handle, bool, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" || path == "." {
		return 0, false, fmt.Errorf("path is required")
	}
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, false, err
	}
	attrs, err := windows.GetFileAttributes(p)
	if err != nil {
		return 0, false, err
	}
	isDir := attrs&windows.FILE_ATTRIBUTE_DIRECTORY != 0
	flags := uint32(0)
	if isDir {
		flags |= windows.FILE_FLAG_BACKUP_SEMANTICS
	}
	const fileReadData = 0x00000001
	const fileReadAttributes = 0x00000080
	h, err := windows.CreateFile(
		p,
		fileReadData|fileReadAttributes,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		flags,
		0,
	)
	if err != nil {
		return 0, false, err
	}
	return h, isDir, nil
}

func walkCloudFiles(path string, fn func(string) error) error {
	info, err := filepath.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fn(path)
	}
	return filepath.WalkDir(path, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if err := fn(current); err != nil {
			return fmt.Errorf("%s: %w", current, err)
		}
		return nil
	})
}

func requestSyncPlatform(root string) bool {
	activeWinProvider.RLock()
	p := activeWinProvider.p
	activeWinProvider.RUnlock()
	if p == nil {
		return false
	}
	if strings.TrimSpace(root) != "" && !sameWindowsPath(root, p.root) {
		return false
	}
	select {
	case p.manualSync <- struct{}{}:
	default:
	}
	return true
}

func sameWindowsPath(a, b string) bool {
	ap, aErr := filepath.Abs(a)
	bp, bErr := filepath.Abs(b)
	if aErr != nil || bErr != nil {
		return false
	}
	return strings.EqualFold(filepath.Clean(ap), filepath.Clean(bp))
}

