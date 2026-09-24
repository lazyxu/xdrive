//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	xupdate "github.com/lazyxu/xdrive/internal/update"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

func platformDoctorChecks(mountPath string) []doctorCheck {
	var checks []doctorCheck
	checks = append(checks, windowsUpdateTransactionCheck())
	if mountPath != "" {
		path16, err := windows.UTF16PtrFromString(filepath.VolumeName(mountPath) + "\\")
		if err == nil {
			var free, total, totalFree uint64
			if err = windows.GetDiskFreeSpaceEx(path16, &free, &total, &totalFree); err == nil {
				status := doctorPass
				if total > 0 && free*100/total < 10 {
					status = doctorWarn
				}
				checks = append(checks, doctorCheck{Name: "disk space", Status: status, Detail: fmt.Sprintf("%s free of %s", doctorBytesWin(free), doctorBytesWin(total))})
			} else {
				checks = append(checks, doctorCheck{Name: "disk space", Status: doctorWarn, Detail: err.Error()})
			}
		}

		registered, detail := windowsSyncRootRegistered(mountPath)
		if registered {
			checks = append(checks, doctorCheck{Name: "CfAPI sync root", Status: doctorPass, Detail: detail})
		} else {
			checks = append(checks, doctorCheck{Name: "CfAPI sync root", Status: doctorWarn, Detail: detail})
		}
	}

	if strings.TrimSpace(os.Getenv("XD_DISABLE_AUTO_UPDATE")) == "1" {
		checks = append(checks, doctorCheck{Name: "auto updater", Status: doctorWarn, Detail: "disabled by XD_DISABLE_AUTO_UPDATE=1"})
	} else {
		k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.QUERY_VALUE)
		if err != nil {
			checks = append(checks, doctorCheck{Name: "auto updater", Status: doctorWarn, Detail: "xDriveAgent autorun not readable"})
		} else {
			defer k.Close()
			value, _, valueErr := k.GetStringValue("xDriveAgent")
			if valueErr == nil && strings.Contains(strings.ToLower(value), "xdrive-agent.exe") {
				checks = append(checks, doctorCheck{Name: "auto updater", Status: doctorPass, Detail: "xDriveAgent autorun registered"})
			} else {
				checks = append(checks, doctorCheck{Name: "auto updater", Status: doctorWarn, Detail: "xDriveAgent autorun missing"})
			}
		}
	}
	return checks
}

func windowsUpdateTransactionCheck() doctorCheck {
	state, err := xupdate.LastInstallStatus()
	if err != nil {
		if strings.Contains(err.Error(), "no Windows client update transaction has been recorded") {
			return doctorCheck{Name: "last client update", Status: doctorPass, Detail: "no update transaction recorded"}
		}
		return doctorCheck{Name: "last client update", Status: doctorWarn, Detail: "transaction state unavailable"}
	}
	return windowsUpdateTransactionCheckFromStatus(state)
}

func windowsUpdateTransactionCheckFromStatus(state xupdate.InstallStatus) doctorCheck {
	status := doctorWarn
	label := strings.TrimSpace(state.State)
	switch label {
	case "success":
		status = doctorPass
	case "rolled_back":
		status = doctorWarn
	case "failed":
		status = doctorFail
	case "preparing", "installing", "verifying":
		status = doctorWarn
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
	return doctorCheck{Name: "last client update", Status: status, Detail: detail}
}

func windowsSyncRootRegistered(root string) (bool, string) {
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
				return true, "registered: " + doctorPath(root)
			}
		}
		sub.Close()
	}
	return false, "not registered for " + doctorPath(root)
}

func doctorBytesWin(v uint64) string {
	const unit = 1024
	if v < unit {
		return fmt.Sprintf("%d B", v)
	}
	div, exp := uint64(unit), 0
	for n := v / unit; n >= unit && exp < 3; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(v)/float64(div), "KMGT"[exp])
}
