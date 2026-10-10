//go:build windows

package localpush

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

func platformNativeItemIdentity(path string, info os.FileInfo) (nativeItemObject, error) {
	f, err := os.Open(path)
	if err != nil {
		return nativeItemObject{}, fmt.Errorf("%w: open native identity: %v", ErrRootChanged, err)
	}
	defer f.Close()
	var handle windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(f.Fd()), &handle); err != nil {
		return nativeItemObject{}, fmt.Errorf("%w: native identity: %v", ErrRootChanged, err)
	}
	// Junctions, shortcuts and other reparse points are not acceptable.
	if handle.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return nativeItemObject{}, ErrUnsafeRoot
	}
	if info.IsDir() != (handle.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0) {
		return nativeItemObject{}, ErrRootChanged
	}
	return nativeItemObject{
		Token: fmt.Sprintf("windows:%d:%d:%d:%d:%d",
			handle.VolumeSerialNumber, handle.FileIndexHigh, handle.FileIndexLow,
			handle.CreationTime.HighDateTime, handle.CreationTime.LowDateTime),
		Strong:    true,
		LinkCount: uint64(handle.NumberOfLinks),
	}, nil
}
