//go:build !windows

package main

import (
	"fmt"
	"os/exec"
	"runtime"
)

func openFolderPlatform(path string) error {
	switch runtime.GOOS {
	case "linux":
		return exec.Command("xdg-open", path).Start()
	default:
		return fmt.Errorf("open folder is not supported on %s", runtime.GOOS)
	}
}

func openFilePlatform(path string) error {
	return openFolderPlatform(path)
}

func selectFilePlatform(path string) error {
	return openFolderPlatform(path)
}
