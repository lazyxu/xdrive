//go:build windows

package localpush

import (
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

// Preflight is read-only and does not authorize upload. Reject reparse points
// on the leaf and observed ancestors, and compare the opened file handle to
// the journal's native identity after reading.
func openRootScopedRegularFile(grant RootGrant, relative string) (*os.File, error) {
	full := filepath.Join(grant.Path, filepath.FromSlash(relative))
	for parent := filepath.Dir(full); ; parent = filepath.Dir(parent) {
		encoded, err := windows.UTF16PtrFromString(parent)
		if err != nil {
			return nil, err
		}
		attributes, err := windows.GetFileAttributes(encoded)
		if err != nil {
			return nil, err
		}
		if attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 ||
			attributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 {
			return nil, ErrUnsafeRoot
		}
		if parent == grant.Path {
			break
		}
		if parent == filepath.Dir(parent) {
			return nil, ErrUnsafeRoot
		}
	}
	ptr, err := windows.UTF16PtrFromString(full)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(ptr, windows.GENERIC_READ,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	var details windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &details); err != nil {
		windows.CloseHandle(handle)
		return nil, err
	}
	if details.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 ||
		details.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0 {
		windows.CloseHandle(handle)
		return nil, ErrUnsafeRoot
	}
	file := os.NewFile(uintptr(handle), full)
	if file == nil {
		windows.CloseHandle(handle)
		return nil, fmt.Errorf("cannot wrap verified Windows file handle")
	}
	return file, nil
}
