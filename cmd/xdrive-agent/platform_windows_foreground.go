//go:build windows

package main

import (
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32Explorer                  = syscall.NewLazyDLL("user32.dll")
	procEnumExplorerWindows         = user32Explorer.NewProc("EnumWindows")
	procGetExplorerWindowClass      = user32Explorer.NewProc("GetClassNameW")
	procGetExplorerWindowText       = user32Explorer.NewProc("GetWindowTextW")
	procIsExplorerWindowVisible     = user32Explorer.NewProc("IsWindowVisible")
	procGetExplorerForegroundWindow = user32Explorer.NewProc("GetForegroundWindow")
	procShowExplorerWindow          = user32Explorer.NewProc("ShowWindow")
	procSetExplorerForegroundWindow = user32Explorer.NewProc("SetForegroundWindow")

	// NewCallback registrations are permanent on Windows. Reuse ONE callback
	// instead of leaking a callback slot on every Explorer reveal.
	explorerEnumWindowsCallback = syscall.NewCallback(collectExplorerWindow)
	explorerEnumWindowsState    = struct {
		sync.Mutex
		windows *[]explorerWindowState
	}{}
)

const (
	swExplorerMinimize = 6
	swExplorerRestore  = 9
)

func currentForegroundWindow() uintptr {
	foreground, _, _ := procGetExplorerForegroundWindow.Call()
	return foreground
}

func collectExplorerWindow(hwnd, _ uintptr) uintptr {
	if explorerEnumWindowsState.windows == nil {
		return 0
	}
	visible, _, _ := procIsExplorerWindowVisible.Call(hwnd)
	if visible == 0 {
		return 1
	}
	var class [64]uint16
	size, _, _ := procGetExplorerWindowClass.Call(hwnd,
		uintptr(unsafe.Pointer(&class[0])), uintptr(len(class)))
	if size == 0 {
		return 1
	}
	className := syscall.UTF16ToString(class[:size])
	if className != "CabinetWClass" && className != "ExploreWClass" {
		return 1
	}
	var caption [512]uint16
	length, _, _ := procGetExplorerWindowText.Call(hwnd,
		uintptr(unsafe.Pointer(&caption[0])), uintptr(len(caption)))
	*explorerEnumWindowsState.windows = append(*explorerEnumWindowsState.windows, explorerWindowState{
		handle: hwnd, title: syscall.UTF16ToString(caption[:length]),
	})
	return 1
}

func visibleExplorerWindows() []explorerWindowState {
	explorerEnumWindowsState.Lock()
	defer explorerEnumWindowsState.Unlock()

	result := make([]explorerWindowState, 0, 4)
	explorerEnumWindowsState.windows = &result
	defer func() { explorerEnumWindowsState.windows = nil }()
	procEnumExplorerWindows.Call(explorerEnumWindowsCallback, 0)
	return result
}

func wasExplorerWindowPresent(before []explorerWindowState, hwnd uintptr) bool {
	for _, window := range before {
		if window.handle == hwnd {
			return true
		}
	}
	return false
}

// Windows can reject SetForegroundWindow from the background Agent. Only try
// the minimize/restore fallback on the particular Explorer window we matched,
// never on xDrive or on other apps, and never for ordinary Open file actions.
func activateExplorerWindow(hwnd uintptr) {
	if hwnd == 0 || currentForegroundWindow() == hwnd {
		return
	}
	procShowExplorerWindow.Call(hwnd, swExplorerRestore)
	procSetExplorerForegroundWindow.Call(hwnd)
	if currentForegroundWindow() == hwnd {
		return
	}
	procShowExplorerWindow.Call(hwnd, swExplorerMinimize)
	procShowExplorerWindow.Call(hwnd, swExplorerRestore)
	procSetExplorerForegroundWindow.Call(hwnd)
}

func startExplorerForeground(command *exec.Cmd, folder string) error {
	previous := visibleExplorerWindows()
	originalForeground := currentForegroundWindow()
	if err := command.Start(); err != nil {
		return err
	}
	// Explorer may hand the request to its existing shell process and return.
	// Release the launch handle without waiting for an Explorer window to close.
	if command.Process != nil {
		_ = command.Process.Release()
	}
	deadline := time.Now().Add(1500 * time.Millisecond)
	for {
		foreground := currentForegroundWindow()
		if originalForeground != 0 && foreground != 0 && foreground != originalForeground {
			// The user (or Explorer itself) changed focus since the click. Do not
			// steal focus back from that window during delayed shell startup.
			return nil
		}
		windows := visibleExplorerWindows()
		hwnd := chooseExplorerWindowToActivate(previous, windows, folder)
		if hwnd != 0 && (!wasExplorerWindowPresent(previous, hwnd) || time.Until(deadline) <= 800*time.Millisecond) {
			activateExplorerWindow(hwnd)
			return nil
		}
		if time.Now().After(deadline) {
			return nil // reveal succeeded; foreground activation is best-effort
		}
		time.Sleep(75 * time.Millisecond)
	}
}
