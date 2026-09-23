//go:build windows

package main

import (
	"context"
	"fmt"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	trayUser32   = windows.NewLazySystemDLL("user32.dll")
	trayShell32  = windows.NewLazySystemDLL("shell32.dll")
	trayKernel32 = windows.NewLazySystemDLL("kernel32.dll")

	trayRegisterClassEx   = trayUser32.NewProc("RegisterClassExW")
	trayCreateWindowEx    = trayUser32.NewProc("CreateWindowExW")
	trayDefWindowProc     = trayUser32.NewProc("DefWindowProcW")
	trayDestroyWindow     = trayUser32.NewProc("DestroyWindow")
	trayGetMessage        = trayUser32.NewProc("GetMessageW")
	trayTranslateMessage  = trayUser32.NewProc("TranslateMessage")
	trayDispatchMessage   = trayUser32.NewProc("DispatchMessageW")
	trayPostQuitMessage   = trayUser32.NewProc("PostQuitMessage")
	trayPostMessage       = trayUser32.NewProc("PostMessageW")
	trayCreatePopupMenu   = trayUser32.NewProc("CreatePopupMenu")
	trayAppendMenu        = trayUser32.NewProc("AppendMenuW")
	trayDestroyMenu       = trayUser32.NewProc("DestroyMenu")
	trayTrackPopupMenu    = trayUser32.NewProc("TrackPopupMenu")
	trayGetCursorPos      = trayUser32.NewProc("GetCursorPos")
	traySetForegroundWin  = trayUser32.NewProc("SetForegroundWindow")
	trayLoadIcon          = trayUser32.NewProc("LoadIconW")
	trayMessageBox        = trayUser32.NewProc("MessageBoxW")
	trayRegisterWindowMsg = trayUser32.NewProc("RegisterWindowMessageW")
	trayShellNotifyIcon   = trayShell32.NewProc("Shell_NotifyIconW")
	trayGetModuleHandle   = trayKernel32.NewProc("GetModuleHandleW")
)

const (
	trayWMDestroy    = 0x0002
	trayWMClose      = 0x0010
	trayWMLButtonUp  = 0x0202
	trayWMLButtonDbl = 0x0203
	trayWMRButtonUp  = 0x0205
	trayWMCallback   = 0x0400 + 1

	trayNIMAdd     = 0x0000
	trayNIMDelete  = 0x0002
	trayNIFMessage = 0x0001
	trayNIFIcon    = 0x0002
	trayNIFTip     = 0x0004

	trayMFString    = 0x0000
	trayMFGray      = 0x0001
	trayMFSeparator = 0x0800

	trayTPMLeftAlign = 0x0000
	trayTPMRightBtn  = 0x0002
	trayTPMReturnCmd = 0x0100

	trayIDIApplication = 32512

	trayMenuOpen    = 1
	trayMenuAccount = 2
	trayMenuPause   = 3
	trayMenuUpdate  = 4
	trayMenuLogout  = 5
	trayMenuExit    = 6
)

type trayPoint struct{ X, Y int32 }

type trayMessage struct {
	HWnd    windows.Handle
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      trayPoint
}

type trayWndClassEx struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     windows.Handle
	HIcon         windows.Handle
	HCursor       windows.Handle
	HbrBackground windows.Handle
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       windows.Handle
}

type trayNotifyIconData struct {
	CbSize           uint32
	HWnd             windows.Handle
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            windows.Handle
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         windows.GUID
	HBalloonIcon     windows.Handle
}

func runDesktopUI(ctx context.Context, cancel context.CancelFunc, ctrl *agentController, control controlUI) error {
	for _, p := range []*windows.LazyProc{trayRegisterClassEx, trayShellNotifyIcon, trayTrackPopupMenu} {
		if err := p.Find(); err != nil {
			return fmt.Errorf("Windows tray unavailable: %w", err)
		}
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	instance, _, _ := trayGetModuleHandle.Call(0)
	className, err := windows.UTF16PtrFromString("xDriveTrayWindow")
	if err != nil {
		return err
	}
	taskbarName, _ := windows.UTF16PtrFromString("TaskbarCreated")
	taskbarCreated, _, _ := trayRegisterWindowMsg.Call(uintptr(unsafe.Pointer(taskbarName)))

	var hwnd windows.Handle
	var nid trayNotifyIconData
	wndProc := windows.NewCallback(func(h windows.Handle, message uint32, wparam, lparam uintptr) uintptr {
		switch message {
		case trayWMCallback:
			switch uint32(lparam) {
			case trayWMLButtonDbl:
				go trayOpen(ctrl, control)
			case trayWMLButtonUp, trayWMRButtonUp:
				showXDriveMenu(h, ctrl, control, cancel)
			}
			return 0
		case trayWMClose:
			trayDestroyWindow.Call(uintptr(h))
			return 0
		case trayWMDestroy:
			trayPostQuitMessage.Call(0)
			return 0
		case uint32(taskbarCreated):
			trayShellNotifyIcon.Call(trayNIMAdd, uintptr(unsafe.Pointer(&nid)))
			return 0
		}
		ret, _, _ := trayDefWindowProc.Call(uintptr(h), uintptr(message), wparam, lparam)
		return ret
	})

	class := trayWndClassEx{
		LpfnWndProc:   wndProc,
		HInstance:     windows.Handle(instance),
		LpszClassName: className,
	}
	class.CbSize = uint32(unsafe.Sizeof(class))
	if atom, _, callErr := trayRegisterClassEx.Call(uintptr(unsafe.Pointer(&class))); atom == 0 {
		return fmt.Errorf("register tray window: %w", callErr)
	}

	h, _, callErr := trayCreateWindowEx.Call(
		0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(className)),
		0, 0, 0, 0, 0, 0, 0, instance, 0,
	)
	if h == 0 {
		return fmt.Errorf("create tray window: %w", callErr)
	}
	hwnd = windows.Handle(h)

	icon, _, _ := trayLoadIcon.Call(0, trayIDIApplication)
	nid = trayNotifyIconData{
		HWnd:             hwnd,
		UID:              1,
		UFlags:           trayNIFMessage | trayNIFIcon | trayNIFTip,
		UCallbackMessage: trayWMCallback,
		HIcon:            windows.Handle(icon),
	}
	nid.CbSize = uint32(unsafe.Sizeof(nid))
	copyTrayUTF16(nid.SzTip[:], "xDrive")
	trayShellNotifyIcon.Call(trayNIMAdd, uintptr(unsafe.Pointer(&nid)))
	defer trayShellNotifyIcon.Call(trayNIMDelete, uintptr(unsafe.Pointer(&nid)))

	go func() {
		<-ctx.Done()
		trayPostMessage.Call(uintptr(hwnd), trayWMClose, 0, 0)
	}()

	var msg trayMessage
	for {
		ret, _, _ := trayGetMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(ret) <= 0 {
			return nil
		}
		trayTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		trayDispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
	}
}

func showXDriveMenu(hwnd windows.Handle, ctrl *agentController, control controlUI, cancel context.CancelFunc) {
	s := ctrl.Snapshot()
	menu, _, _ := trayCreatePopupMenu.Call()
	if menu == 0 {
		return
	}
	defer trayDestroyMenu.Call(menu)

	account := "账户：未登录"
	if s.Username != "" {
		account = "账户：" + s.Username + " · " + s.AuthStatus
	}
	appendTrayItem(menu, trayMFString|trayMFGray, 0, account)
	appendTrayItem(menu, trayMFString|trayMFGray, 0, "同步："+s.SyncStatus)
	appendTrayItem(menu, trayMFSeparator, 0, "")

	openFlags := uintptr(trayMFString)
	if !s.Configured {
		openFlags |= trayMFGray
	}
	appendTrayItem(menu, openFlags, trayMenuOpen, "打开 xDrive")
	accountTitle := "登录 / 注册..."
	if s.Configured {
		accountTitle = "账户 / 设置..."
	}
	appendTrayItem(menu, trayMFString, trayMenuAccount, accountTitle)

	pauseFlags := uintptr(trayMFString)
	if !s.Configured || s.AuthStatus != "已登录" {
		pauseFlags |= trayMFGray
	}
	pauseTitle := "暂停同步"
	if s.Paused {
		pauseTitle = "恢复同步"
	}
	appendTrayItem(menu, pauseFlags, trayMenuPause, pauseTitle)
	appendTrayItem(menu, trayMFString, trayMenuUpdate, "检查更新")

	logoutFlags := uintptr(trayMFString)
	if !s.Configured {
		logoutFlags |= trayMFGray
	}
	appendTrayItem(menu, logoutFlags, trayMenuLogout, "注销")
	appendTrayItem(menu, trayMFSeparator, 0, "")
	appendTrayItem(menu, trayMFString, trayMenuExit, "退出 xDrive")

	traySetForegroundWin.Call(uintptr(hwnd))
	var pt trayPoint
	trayGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	cmd, _, _ := trayTrackPopupMenu.Call(
		menu,
		trayTPMLeftAlign|trayTPMRightBtn|trayTPMReturnCmd,
		uintptr(pt.X), uintptr(pt.Y), 0, uintptr(hwnd), 0,
	)

	switch cmd {
	case trayMenuOpen:
		go trayOpen(ctrl, control)
	case trayMenuAccount:
		go func() {
			if control == nil {
				showTrayMessage("xDrive", "本机登录/设置页面不可用。")
				return
			}
			if err := control.Open(); err != nil {
				showTrayMessage("xDrive", "打开登录/设置页面失败："+err.Error())
			}
		}()
	case trayMenuPause:
		go func() {
			if err := ctrl.TogglePause(); err != nil {
				showTrayMessage("xDrive", "切换同步状态失败："+err.Error())
			}
		}()
	case trayMenuUpdate:
		go func() {
			message, installing := ctrl.CheckUpdate()
			showTrayMessage("xDrive 更新", message)
			if installing {
				cancel()
			}
		}()
	case trayMenuLogout:
		go func() {
			if err := ctrl.Logout(); err != nil {
				showTrayMessage("xDrive", "注销失败："+err.Error())
			}
		}()
	case trayMenuExit:
		cancel()
	}
}

func trayOpen(ctrl *agentController, control controlUI) {
	if err := ctrl.OpenFolder(); err == nil {
		return
	}
	if control != nil {
		_ = control.Open()
	}
}

func appendTrayItem(menu, flags, id uintptr, text string) {
	var p *uint16
	if text != "" {
		p, _ = windows.UTF16PtrFromString(text)
	}
	trayAppendMenu.Call(menu, flags, id, uintptr(unsafe.Pointer(p)))
}

func showTrayMessage(title, body string) {
	t, _ := windows.UTF16PtrFromString(title)
	b, _ := windows.UTF16PtrFromString(body)
	trayMessageBox.Call(0, uintptr(unsafe.Pointer(b)), uintptr(unsafe.Pointer(t)), 0x40)
}

func copyTrayUTF16(dst []uint16, s string) {
	encoded := windows.StringToUTF16(s)
	if len(encoded) > len(dst) {
		encoded = encoded[:len(dst)]
		encoded[len(encoded)-1] = 0
	}
	copy(dst, encoded)
}
