//go:build windows

package localpush

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

func platformRootIdentity(path string, info os.FileInfo) (string, bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", false, fmt.Errorf("%w: %v", ErrRootChanged, err)
	}
	defer f.Close()
	var handle windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(f.Fd()), &handle); err != nil {
		return "", false, fmt.Errorf("%w: %v", ErrRootChanged, err)
	}
	if handle.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return "", false, ErrUnsafeRoot
	}
	return fmt.Sprintf("windows:%d:%d:%d:%d:%d",
		handle.VolumeSerialNumber, handle.FileIndexHigh, handle.FileIndexLow,
		handle.CreationTime.HighDateTime, handle.CreationTime.LowDateTime), true, nil
}
