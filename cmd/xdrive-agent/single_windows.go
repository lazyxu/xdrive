//go:build windows

package main

import (
	"errors"
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

var procCreateMutexW = windows.NewLazySystemDLL("kernel32.dll").NewProc("CreateMutexW")

func acquireSingleInstance() (func(), error) {
	name, err := windows.UTF16PtrFromString(`Local\xDriveAgent`)
	if err != nil {
		return nil, err
	}
	h, _, callErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if h == 0 {
		return nil, fmt.Errorf("CreateMutexW: %w", callErr)
	}
	handle := windows.Handle(h)
	if errors.Is(callErr, windows.ERROR_ALREADY_EXISTS) {
		_ = windows.CloseHandle(handle)
		return nil, errAlreadyRunning
	}
	return func() { _ = windows.CloseHandle(handle) }, nil
}
