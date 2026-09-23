//go:build windows

package main

import "os/exec"

func openFolderPlatform(path string) error {
	return exec.Command("explorer.exe", path).Start()
}

func openFilePlatform(path string) error {
	return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", path).Start()
}

func selectFilePlatform(path string) error {
	return exec.Command("explorer.exe", "/select,"+path).Start()
}
