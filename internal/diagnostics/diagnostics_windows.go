//go:build windows

package diagnostics

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	xupdate "github.com/lazyxu/xdrive/internal/update"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

func PlatformChecks(mountPath string) []Check {
	var checks []Check
	checks = append(checks, windowsUpdateTransactionCheck())
	if mountPath != "" {
		path16, err := windows.UTF16PtrFromString(filepath.VolumeName(mountPath) + "\\")
		if err == nil {
			var free, total, totalFree uint64
			if err = windows.GetDiskFreeSpaceEx(path16, &free, &total, &totalFree); err == nil {
				status := Pass
				if total > 0 && free*100/total < 10 {
					status = Warn
				}
				checks = append(checks, Check{Name: "disk space", Status: status, Detail: fmt.Sprintf("%s free of %s", FormatBytes(free), FormatBytes(total))})
			} else {
				checks = append(checks, Check{Name: "disk space", Status: Warn, Detail: err.Error()})
			}
		}

		registered, detail := WindowsSyncRootRegistered(mountPath)
		if registered {
			checks = append(checks, Check{Name: "CfAPI sync root", Status: Pass, Detail: detail})
		} else {
			checks = append(checks, Check{Name: "CfAPI sync root", Status: Warn, Detail: detail})
		}
	}

	if strings.TrimSpace(os.Getenv("XD_DISABLE_AUTO_UPDATE")) == "1" {
		checks = append(checks, Check{Name: "auto updater", Status: Warn, Detail: "disabled by XD_DISABLE_AUTO_UPDATE=1"})
	} else {
		k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.QUERY_VALUE)
		if err != nil {
			checks = append(checks, Check{Name: "auto updater", Status: Warn, Detail: "xDriveAgent autorun not readable"})
		} else {
			defer k.Close()
			value, _, valueErr := k.GetStringValue("xDriveAgent")
			if valueErr == nil && strings.Contains(strings.ToLower(value), "xdrive-agent.exe") {
				checks = append(checks, Check{Name: "auto updater", Status: Pass, Detail: "xDriveAgent autorun registered"})
			} else {
				checks = append(checks, Check{Name: "auto updater", Status: Warn, Detail: "xDriveAgent autorun missing"})
			}
		}
	}
	return checks
}

func windowsUpdateTransactionCheck() Check {
	state, err := xupdate.LastInstallStatus()
	if err != nil {
		if strings.Contains(err.Error(), "no Windows client update transaction has been recorded") {
			return Check{Name: "last client update", Status: Pass, Detail: "no update transaction recorded"}
		}
		return Check{Name: "last client update", Status: Warn, Detail: "transaction state unavailable"}
	}
	return WindowsUpdateTransactionCheckFromStatus(state)
}

func WindowsUpdateTransactionCheckFromStatus(state xupdate.InstallStatus) Check {
	status := Warn
	label := strings.TrimSpace(state.State)
	switch label {
	case "success":
		status = Pass
	case "rolled_back":
		status = Warn
	case "failed":
		status = Fail
	case "preparing", "installing", "verifying":
		status = Warn
	default:
		label = "unknown"
	}

	detail := label
	if target := strings.TrimSpace(state.TargetVersion); target != "" {
		detail += " -> " + target
	}
	if updated := strings.TrimSpace(state.UpdatedAt); updated != "" {
		detail += " @ " + updated
	}
	return Check{Name: "last client update", Status: status, Detail: detail}
}

func WindowsSyncRootRegistered(root string) (bool, string) {
	base, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Explorer\SyncRootManager`, registry.READ)
	if err != nil {
		return false, "SyncRootManager registry key unavailable"
	}
	defer base.Close()
	names, err := base.ReadSubKeyNames(0)
	if err != nil {
		return false, "cannot enumerate SyncRootManager"
	}
	want := filepath.Clean(root)
	for _, name := range names {
		sub, err := registry.OpenKey(base, name+`\UserSyncRoots`, registry.READ)
		if err != nil {
			continue
		}
		values, _ := sub.ReadValueNames(0)
		for _, valueName := range values {
			got, _, valueErr := sub.GetStringValue(valueName)
			if valueErr == nil && strings.EqualFold(filepath.Clean(got), want) {
				sub.Close()
				return true, "registered: " + DisplayPath(root)
			}
		}
		sub.Close()
	}
	return false, "not registered for " + DisplayPath(root)
}
