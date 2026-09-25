//go:build windows

package main

import (
	"github.com/lazyxu/xdrive/internal/diagnostics"
	xupdate "github.com/lazyxu/xdrive/internal/update"
)

func platformDoctorChecks(mountPath string) []doctorCheck {
	return diagnostics.PlatformChecks(mountPath)
}

func windowsUpdateTransactionCheck() doctorCheck {
	for _, check := range diagnostics.PlatformChecks("") {
		if check.Name == "last client update" {
			return check
		}
	}
	return doctorCheck{Name: "last client update", Status: doctorWarn, Detail: "transaction state unavailable"}
}

func windowsUpdateTransactionCheckFromStatus(state xupdate.InstallStatus) doctorCheck {
	return diagnostics.WindowsUpdateTransactionCheckFromStatus(state)
}

func windowsSyncRootRegistered(root string) (bool, string) {
	return diagnostics.WindowsSyncRootRegistered(root)
}

func doctorBytesWin(v uint64) string {
	return diagnostics.FormatBytes(v)
}
