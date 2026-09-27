//go:build windows

package main

import (
	"fmt"
	"strings"

	"github.com/lazyxu/xdrive/internal/mount"
	"github.com/lazyxu/xdrive/internal/shellintegration"
)

func runShellAction(args []string) (bool, error) {
	if len(args) == 0 || args[0] != "--shell-action" {
		return false, nil
	}
	if len(args) < 2 {
		return true, fmt.Errorf("missing Explorer shell action")
	}
	action := strings.TrimSpace(args[1])
	if action == "unregister" {
		if len(args) != 2 {
			return true, fmt.Errorf("unregister does not accept a path")
		}
		return true, shellintegration.UnregisterExplorerActions()
	}
	if len(args) != 3 {
		return true, fmt.Errorf("Explorer shell action %q requires exactly one path", action)
	}
	_, root, abs, err := managedPath(args[2])
	if err != nil {
		return true, err
	}
	switch action {
	case "keep":
		err = mount.KeepLocal(abs)
	case "release":
		err = mount.ReleaseSpace(abs)
	default:
		return true, fmt.Errorf("unknown Explorer shell action %q", action)
	}
	if err != nil {
		return true, err
	}
	_ = mount.RequestSync(root)
	return true, nil
}
