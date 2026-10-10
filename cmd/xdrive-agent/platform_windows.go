//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	shell32              = windows.NewLazySystemDLL("shell32.dll")
	procSHOpenWithDialog = shell32.NewProc("SHOpenWithDialog")
)

const openAsInfoExec = 0x00000004

type openAsInfo struct {
	File  *uint16
	Class *uint16
	Flags uint32
}

func openFolderPlatform(path string) error {
	return startExplorerForeground(exec.Command("explorer.exe", path), filepath.Base(path))
}

func openFilePlatform(path string) error {
	return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", path).Start()
}

func selectFilePlatform(path string) error {
	return startExplorerForeground(exec.Command("explorer.exe", "/select,"+path), filepath.Base(filepath.Dir(path)))
}

func openWithSupportedPlatform() bool { return true }

func openWithPlatform(path string) error {
	file, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	info := openAsInfo{
		File:  file,
		Flags: openAsInfoExec,
	}
	hr, _, _ := procSHOpenWithDialog.Call(
		0,
		uintptr(unsafe.Pointer(&info)),
	)
	runtime.KeepAlive(file)
	runtime.KeepAlive(info)
	if int32(hr) < 0 {
		return fmt.Errorf("SHOpenWithDialog failed: HRESULT 0x%08x", uint32(hr))
	}
	return nil
}
