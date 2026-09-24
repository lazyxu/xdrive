//go:build !linux && !windows

package main

func platformDoctorChecks(string) []doctorCheck {
	return []doctorCheck{{Name: "platform checks", Status: doctorWarn, Detail: "no platform-specific diagnostics for this OS"}}
}
