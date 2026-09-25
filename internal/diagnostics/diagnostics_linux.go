//go:build linux

package diagnostics

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

func PlatformChecks(mountPath string) []Check {
	var checks []Check
	if mountPath != "" {
		var stat syscall.Statfs_t
		if err := syscall.Statfs(mountPath, &stat); err != nil {
			parent := filepath.Dir(mountPath)
			if parentErr := syscall.Statfs(parent, &stat); parentErr != nil {
				checks = append(checks, Check{Name: "disk space", Status: Warn, Detail: err.Error()})
			} else {
				checks = append(checks, linuxDiskCheck(stat))
			}
		} else {
			checks = append(checks, linuxDiskCheck(stat))
		}

		if out, err := exec.Command("findmnt", "-T", mountPath, "-n", "-o", "FSTYPE,SOURCE").CombinedOutput(); err == nil {
			text := strings.TrimSpace(string(out))
			if strings.Contains(strings.ToLower(text), "fuse") || strings.Contains(strings.ToLower(text), "xdrive") {
				checks = append(checks, Check{Name: "FUSE mount", Status: Pass, Detail: text})
			} else {
				checks = append(checks, Check{Name: "FUSE mount", Status: Warn, Detail: "sync root exists but is not currently mounted by xDrive"})
			}
		} else {
			checks = append(checks, Check{Name: "FUSE mount", Status: Warn, Detail: "findmnt unavailable or mount not active"})
		}
	}

	if _, err := exec.LookPath("systemctl"); err != nil {
		checks = append(checks, Check{Name: "updater timer", Status: Warn, Detail: "systemctl unavailable"})
		return checks
	}
	checks = append(checks, systemdCheck("updater timer", false, "xdrive-update.timer"))
	checks = append(checks, systemdCheck("mount agent", true, "xdrive-agent.service"))
	return checks
}

func linuxDiskCheck(stat syscall.Statfs_t) Check {
	free := uint64(stat.Bavail) * uint64(stat.Bsize)
	total := uint64(stat.Blocks) * uint64(stat.Bsize)
	status := Pass
	if total > 0 && free*100/total < 10 {
		status = Warn
	}
	return Check{Name: "disk space", Status: status, Detail: fmt.Sprintf("%s free of %s", FormatBytes(free), FormatBytes(total))}
}

func systemdCheck(name string, user bool, unit string) Check {
	args := []string{}
	if user {
		args = append(args, "--user")
	}
	activeArgs := append(append([]string{}, args...), "is-active", unit)
	out, err := exec.Command("systemctl", activeArgs...).CombinedOutput()
	state := strings.TrimSpace(string(out))
	if err == nil && state == "active" {
		return Check{Name: name, Status: Pass, Detail: unit + " active"}
	}
	if state == "" {
		state = "inactive/unavailable"
	}
	return Check{Name: name, Status: Warn, Detail: unit + " " + state}
}
