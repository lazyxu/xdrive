//go:build !windows

package main

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
)

func openFolderPlatform(path string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", path).Start()
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
	if runtime.GOOS == "darwin" {
		return exec.Command("open", "-R", path).Start()
	}
	return openFolderPlatform(filepath.Dir(path))
}

func openWithSupportedPlatform() bool { return false }

func openWithPlatform(string) error {
	return fmt.Errorf("Open With is not supported on %s", runtime.GOOS)
}
