//go:build !linux && !windows

package main

import "github.com/lazyxu/xdrive/internal/diagnostics"

func platformDoctorChecks(mountPath string) []doctorCheck {
	return diagnostics.PlatformChecks(mountPath)
}
