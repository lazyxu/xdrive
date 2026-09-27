//go:build !windows

package main

import "fmt"

func runShellAction(args []string) (bool, error) {
	if len(args) > 0 && args[0] == "--shell-action" {
		return true, fmt.Errorf("Explorer shell actions require Windows")
	}
	return false, nil
}
