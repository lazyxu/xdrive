//go:build linux

package main

import "github.com/lazyxu/xdrive/internal/diagnostics"

func platformDoctorChecks(mountPath string) []doctorCheck {
	return diagnostics.PlatformChecks(mountPath)
}

func doctorBytes(v uint64) string {
	return diagnostics.FormatBytes(v)
}
