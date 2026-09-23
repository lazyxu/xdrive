//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"
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
	trayLoadImage         = trayUser32.NewProc("LoadImageW")
	trayDestroyIcon       = trayUser32.NewProc("DestroyIcon")
	trayMessageBox        = trayUser32.NewProc("MessageBoxW")
	trayRegisterWindowMsg = trayUser32.NewProc("RegisterWindowMessageW")
	trayShellNotifyIcon   = trayShell32.NewProc("Shell_NotifyIconW")
	trayGetModuleHandle   = trayKernel32.NewProc("GetModuleHandleW")
)

const (
	trayWMDestroy     = 0x0002
	trayWMClose       = 0x0010
	trayWMContextMenu = 0x007B
	trayWMLButtonUp   = 0x0202
	trayWMLButtonDbl  = 0x0203
	trayWMRButtonUp   = 0x0205
	trayNINSelect     = 0x0400
	trayNINKeySelect  = 0x0400 + 1
	trayWMCallback    = 0x0400 + 1

	trayNIMAdd        = 0x0000
	trayNIMModify     = 0x0001
	trayNIMDelete     = 0x0002
	trayNIMSetVersion = 0x0004
	trayNIFMessage    = 0x0001
	trayNIFIcon       = 0x0002
	trayNIFTip        = 0x0004
	trayNIFInfo       = 0x0010

	trayNIIFInfo    = 0x0001
	trayNIIFWarning = 0x0002
	trayNIIFError   = 0x0003

	trayMFString    = 0x0000
	trayMFGray      = 0x0001
	trayMFSeparator = 0x0800

	trayTPMLeftAlign = 0x0000
	trayTPMRightBtn  = 0x0002
	trayTPMReturnCmd = 0x0100

	trayIDIApplication = 32512
	trayIDIError       = 32513
	trayIDIWarning     = 32515
	trayIDIInfo        = 32516

	trayImageIcon      = 1
	trayLRLoadFromFile = 0x0010
	trayLRDefaultSize  = 0x0040
	trayIconVersion4   = 4

	trayMenuOpen      = 1
	trayMenuAccount   = 2
	trayMenuPause     = 3
	trayMenuUpdate    = 4
	trayMenuLogout    = 5
	trayMenuExit      = 6
	trayMenuSyncNow   = 7
	trayMenuConflicts = 8
)

type trayIconSet struct {
	handles map[string]windows.Handle
}

func loadTrayIconSet() trayIconSet {
	set := trayIconSet{handles: map[string]windows.Handle{}}
	for _, key := range []string{"normal", "syncing", "paused", "offline", "conflict"} {
		name := "tray-" + key + ".ico"
		for _, candidate := range trayIconCandidates(name) {
			h, err := loadTrayIconFile(candidate)
			if err == nil && h != 0 {
				set.handles[key] = h
				break
			}
		}
	}
	return set
}

func trayIconCandidates(name string) []string {
	out := make([]string, 0, 2)
	if exe, err := os.Executable(); err == nil {
		out = append(out, filepath.Join(filepath.Dir(exe), "icons", name))
	}
	out = append(out, filepath.Join("packaging", "windows", "icons", name))
	return out
}

func loadTrayIconFile(path string) (windows.Handle, error) {
	if _, err := os.Stat(path); err != nil {
		return 0, err
	}
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	h, _, callErr := trayLoadImage.Call(
		0,
		uintptr(unsafe.Pointer(p)),
		trayImageIcon,
		0,
		0,
		trayLRLoadFromFile|trayLRDefaultSize,
	)
	if h == 0 {
		return 0, fmt.Errorf("load tray icon %s: %w", path, callErr)
	}
	return windows.Handle(h), nil
}

func (s trayIconSet) get(key string, fallback uintptr) windows.Handle {
	if h := s.handles[key]; h != 0 {
		return h
	}
	h, _, _ := trayLoadIcon.Call(0, fallback)
	return windows.Handle(h)
}

func (s trayIconSet) close() {
	for _, h := range s.handles {
		if h != 0 {
			trayDestroyIcon.Call(uintptr(h))
		}
	}
}

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

	icons := loadTrayIconSet()
	defer icons.close()

	var hwnd windows.Handle
	var nid trayNotifyIconData
	var nidMu sync.Mutex
	wndProc := windows.NewCallback(func(h windows.Handle, message uint32, wparam, lparam uintptr) uintptr {
		switch message {
		case trayWMCallback:
			switch trayCallbackEvent(lparam) {
			case trayWMLButtonDbl:
				go trayOpen(ctrl, control)
			case trayWMLButtonUp, trayWMRButtonUp, trayWMContextMenu, trayNINSelect, trayNINKeySelect:
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
			nidMu.Lock()
			nid.UFlags = trayNIFMessage | trayNIFIcon | trayNIFTip
			trayShellNotifyIcon.Call(trayNIMAdd, uintptr(unsafe.Pointer(&nid)))
			nid.UVersion = trayIconVersion4
			trayShellNotifyIcon.Call(trayNIMSetVersion, uintptr(unsafe.Pointer(&nid)))
			nidMu.Unlock()
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

	initialKey, initialFallback, initialTip := trayVisualState(ctrl.Snapshot())
	nid = trayNotifyIconData{
		HWnd:             hwnd,
		UID:              1,
		UFlags:           trayNIFMessage | trayNIFIcon | trayNIFTip,
		UCallbackMessage: trayWMCallback,
		HIcon:            icons.get(initialKey, initialFallback),
	}
	nid.CbSize = uint32(unsafe.Sizeof(nid))
	copyTrayUTF16(nid.SzTip[:], initialTip)
	if ok, _, callErr := trayShellNotifyIcon.Call(trayNIMAdd, uintptr(unsafe.Pointer(&nid))); ok == 0 {
		return fmt.Errorf("add xDrive tray icon: %w", callErr)
	}
	nid.UVersion = trayIconVersion4
	trayShellNotifyIcon.Call(trayNIMSetVersion, uintptr(unsafe.Pointer(&nid)))
	defer trayShellNotifyIcon.Call(trayNIMDelete, uintptr(unsafe.Pointer(&nid)))

	go func() {
		lastKey := initialKey
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case n := <-ctrl.Notifications():
				nidMu.Lock()
				snapshot := nid
				nidMu.Unlock()
				go func(notification agentNotification, fallback trayNotifyIconData) {
					if err := showWindowsToast(notification.Title, notification.Body); err != nil {
						showTrayNotification(&fallback, notification.Title, notification.Body, notification.Kind)
					}
				}(n, snapshot)
			case <-ticker.C:
				s := ctrl.Snapshot()
				key, fallback, tip := trayVisualState(s)
				if key == lastKey {
					continue
				}
				lastKey = key
				nidMu.Lock()
				nid.HIcon = icons.get(key, fallback)
				copyTrayUTF16(nid.SzTip[:], tip)
				nid.UFlags = trayNIFIcon | trayNIFTip
				trayShellNotifyIcon.Call(trayNIMModify, uintptr(unsafe.Pointer(&nid)))
				nidMu.Unlock()
			}
		}
	}()

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

// trayCallbackEvent decodes the event code delivered through NOTIFYICONDATA.uCallbackMessage.
// With NOTIFYICON_VERSION_4, LOWORD(lParam) is the event and HIWORD(lParam) is the icon ID.
// Masking to the low word is also compatible with the legacy callback format.
func trayCallbackEvent(lparam uintptr) uint32 {
	return uint32(lparam & 0xffff)
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

	syncFlags := uintptr(trayMFString)
	if !s.Configured || s.AuthStatus != "已登录" || s.Paused {
		syncFlags |= trayMFGray
	}
	appendTrayItem(menu, syncFlags, trayMenuSyncNow, "立即同步")

	conflictFlags := uintptr(trayMFString)
	if s.ConflictCount == 0 {
		conflictFlags |= trayMFGray
	}
	appendTrayItem(menu, conflictFlags, trayMenuConflicts, fmt.Sprintf("冲突（%d）...", s.ConflictCount))
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
	case trayMenuSyncNow:
		go func() {
			if err := ctrl.SyncNow(); err != nil {
				showTrayMessage("xDrive", "立即同步失败："+err.Error())
			}
		}()
	case trayMenuConflicts:
		go func() {
			if control == nil {
				showTrayMessage("xDrive", "冲突处理页面不可用。")
				return
			}
			if err := control.OpenConflicts(); err != nil {
				showTrayMessage("xDrive", "打开冲突处理失败："+err.Error())
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

func trayVisualState(s agentSnapshot) (string, uintptr, string) {
	visual := classifyTrayState(s)
	switch visual.Key {
	case "conflict":
		return visual.Key, trayIDIWarning, visual.Tip
	case "paused":
		return visual.Key, trayIDIWarning, visual.Tip
	case "offline":
		return visual.Key, trayIDIError, visual.Tip
	case "syncing":
		return visual.Key, trayIDIApplication, visual.Tip
	default:
		return "normal", trayIDIInfo, visual.Tip
	}
}

func showTrayNotification(nid *trayNotifyIconData, title, body, kind string) {
	if nid == nil {
		return
	}
	copyTrayUTF16(nid.SzInfoTitle[:], title)
	copyTrayUTF16(nid.SzInfo[:], body)
	nid.UFlags = trayNIFInfo
	switch kind {
	case "error":
		nid.DwInfoFlags = trayNIIFError
	case "warning":
		nid.DwInfoFlags = trayNIIFWarning
	default:
		nid.DwInfoFlags = trayNIIFInfo
	}
	trayShellNotifyIcon.Call(trayNIMModify, uintptr(unsafe.Pointer(nid)))
}

func showTrayMessage(title, body string) {
	t, _ := windows.UTF16PtrFromString(title)
	b, _ := windows.UTF16PtrFromString(body)
	trayMessageBox.Call(0, uintptr(unsafe.Pointer(b)), uintptr(unsafe.Pointer(t)), 0x40)
}

func copyTrayUTF16(dst []uint16, s string) {
	for i := range dst {
		dst[i] = 0
	}
	encoded := windows.StringToUTF16(s)
	if len(encoded) > len(dst) {
		encoded = encoded[:len(dst)]
		encoded[len(encoded)-1] = 0
	}
	copy(dst, encoded)
}
