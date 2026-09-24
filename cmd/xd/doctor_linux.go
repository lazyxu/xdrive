//go:build linux

package main

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

func platformDoctorChecks(mountPath string) []doctorCheck {
	var checks []doctorCheck
	if mountPath != "" {
		var stat syscall.Statfs_t
		if err := syscall.Statfs(mountPath, &stat); err != nil {
			parent := filepath.Dir(mountPath)
			if parentErr := syscall.Statfs(parent, &stat); parentErr != nil {
				checks = append(checks, doctorCheck{Name: "disk space", Status: doctorWarn, Detail: err.Error()})
			} else {
				checks = append(checks, linuxDiskCheck(stat))
			}
		} else {
			checks = append(checks, linuxDiskCheck(stat))
		}

		if out, err := exec.Command("findmnt", "-T", mountPath, "-n", "-o", "FSTYPE,SOURCE").CombinedOutput(); err == nil {
			text := strings.TrimSpace(string(out))
			if strings.Contains(strings.ToLower(text), "fuse") || strings.Contains(strings.ToLower(text), "xdrive") {
				checks = append(checks, doctorCheck{Name: "FUSE mount", Status: doctorPass, Detail: text})
			} else {
				checks = append(checks, doctorCheck{Name: "FUSE mount", Status: doctorWarn, Detail: "sync root exists but is not currently mounted by xDrive"})
			}
		} else {
			checks = append(checks, doctorCheck{Name: "FUSE mount", Status: doctorWarn, Detail: "findmnt unavailable or mount not active"})
		}
	}

	if _, err := exec.LookPath("systemctl"); err != nil {
		checks = append(checks, doctorCheck{Name: "updater timer", Status: doctorWarn, Detail: "systemctl unavailable"})
		return checks
	}
	checks = append(checks, systemdDoctorCheck("updater timer", false, "xdrive-update.timer"))
	checks = append(checks, systemdDoctorCheck("mount agent", true, "xdrive-agent.service"))
	return checks
}

func linuxDiskCheck(stat syscall.Statfs_t) doctorCheck {
	free := uint64(stat.Bavail) * uint64(stat.Bsize)
	total := uint64(stat.Blocks) * uint64(stat.Bsize)
	status := doctorPass
	if total > 0 && free*100/total < 10 {
		status = doctorWarn
	}
	return doctorCheck{Name: "disk space", Status: status, Detail: fmt.Sprintf("%s free of %s", doctorBytes(free), doctorBytes(total))}
}

func systemdDoctorCheck(name string, user bool, unit string) doctorCheck {
	args := []string{}
	if user {
		args = append(args, "--user")
	}
	activeArgs := append(append([]string{}, args...), "is-active", unit)
	out, err := exec.Command("systemctl", activeArgs...).CombinedOutput()
	state := strings.TrimSpace(string(out))
	if err == nil && state == "active" {
		return doctorCheck{Name: name, Status: doctorPass, Detail: unit + " active"}
	}
	if state == "" {
		state = "inactive/unavailable"
	}
	return doctorCheck{Name: name, Status: doctorWarn, Detail: unit + " " + state}
}

func doctorBytes(v uint64) string {
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
