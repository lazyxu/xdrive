//go:build windows

package localpush

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

func platformEntryIdentity(path string, info os.FileInfo) (string, bool, uint64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", false, 0, fmt.Errorf("%w: %v", ErrEntryIdentityChanged, err)
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil {
		return "", false, 0, fmt.Errorf("%w: %v", ErrEntryIdentityChanged, err)
	}
	if !os.SameFile(info, opened) {
		return "", false, 0, ErrEntryIdentityChanged
	}
	var file windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(f.Fd()), &file); err != nil {
		return "", false, 0, fmt.Errorf("%w: %v", ErrEntryIdentityChanged, err)
	}
	if file.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return "", false, 0, ErrUnsafeRoot
	}
	key := fmt.Sprintf("windows:%d:%d:%d", file.VolumeSerialNumber,
		file.FileIndexHigh, file.FileIndexLow)
	strong := (file.FileIndexHigh != 0 || file.FileIndexLow != 0) &&
		(file.CreationTime.HighDateTime != 0 || file.CreationTime.LowDateTime != 0)
	if strong {
		key = fmt.Sprintf("%s:%d:%d", key,
			file.CreationTime.HighDateTime, file.CreationTime.LowDateTime)
	}
	return key, strong, uint64(file.NumberOfLinks), nil
}
