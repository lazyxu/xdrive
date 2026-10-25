package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	xupdate "github.com/lazyxu/xdrive/internal/update"
)

// portableCLIOnlyDistribution recognizes both published xdrive-backup archives
// and user-local installations made by copying the original binary pair.
// A full Desktop executable in the same installation directory wins.
func portableCLIOnlyDistribution(executable, goos string) bool {
	if executable == "" {
		return false
	}
	if resolved, err := filepath.EvalSymlinks(executable); err == nil {
		executable = resolved
	}
	dir := filepath.Dir(executable)
	agent := "xdrive-agent"
	if goos == "windows" {
		agent += ".exe"
	}
	a, err := os.Lstat(filepath.Join(dir, agent))
	if err != nil || !a.Mode().IsRegular() {
		return false
	}
	installed, err := desktopExecutableInstalled(dir, goos)
	if err != nil {
		return false // unknown layout must never be guessed as CLI-only
	}
	return !installed
}

func runCLIOnlyUpdate(ctx context.Context, current, channel, source string, download bool) error {
	result, err := xupdate.CheckCLIOnlyTargetFromSource(ctx, current, channel, source, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return err
	}
	if !result.UpdateAvailable {
		fmt.Printf("CLI-only xDrive %s is current on %s via %s\n", current, channel, source)
		return nil
	}
	fmt.Printf("CLI-only update: %s -> %s (%s)\n", current, result.Latest, result.Asset.Name)
	if result.Asset.Size > 0 {
		fmt.Printf("archive size: %s\n", formatStorageBytes(result.Asset.Size))
	}
	if !download {
		fmt.Printf("run: xd update --cli-only --download --source %s --channel %s\n", source, channel)
		fmt.Println("This checks the CLI-only release, not the Desktop installer.")
		return nil
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return err
	}
	dir, err := xupdate.CLIOnlyDownloadDir(cache, result.Latest)
	if err != nil {
		return err
	}
	path, err := xupdate.DownloadVerifiedCLIOnly(ctx, xupdate.DefaultChecker(), result, dir,
		func(event xupdate.ProgressEvent) { fmt.Println(xupdate.FormatProgress(event)) })
	if err != nil {
		return err
	}
	fmt.Printf("SHA-256 verified and CLI-only binary/layout checked: %s\n", path)
	fmt.Println("Only downloaded to the user cache. xd and xdrive-agent were NOT installed, replaced or restarted.")
	fmt.Println("An atomic CLI-only install/rollback transaction is required before --install can be enabled.")
	return nil
}

// An explicit GUI distribution is a prerequisite for existing unified Desktop
// installer semantics. Otherwise xd update --install could unexpectedly pull
// in Electron when xd was copied as a standalone command.
// desktopExecutableInstalled recognizes the *actual* packaged GUI layout:
// Linux exposes /usr/bin/xdrive-desktop, while the Windows installer keeps
// xd.exe and Agent at the root, and Electron at desktop/xdrive-desktop.exe.
func desktopExecutableInstalled(dir, goos string) (bool, error) {
	paths := []string{filepath.Join(dir, "xdrive-desktop")}
	if goos == "windows" {
		paths = []string{
			filepath.Join(dir, "desktop", "xdrive-desktop.exe"),
			filepath.Join(dir, "xdrive-desktop.exe"),
		}
	}
	for _, path := range paths {
		info, err := os.Stat(path)
		if err == nil {
			if !info.Mode().IsRegular() {
				return false, fmt.Errorf("Desktop path is not an executable file: %s", path)
			}
			return true, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return false, fmt.Errorf("cannot verify Desktop executable: %w", err)
		}
	}
	return false, nil
}

func requireExistingDesktopDistribution(executable, goos string) error {
	if executable == "" {
		return errors.New("cannot establish CLI installation type; refusing Desktop installer")
	}
	if resolved, err := filepath.EvalSymlinks(executable); err == nil {
		executable = resolved
	}
	present, err := desktopExecutableInstalled(filepath.Dir(executable), goos)
	if err != nil {
		return err
	}
	if !present {
		return errors.New("no installed Desktop executable found beside xd or in the Windows desktop/ directory; refusing to install a GUI/Desktop package (use --cli-only to check or download the portable archive)")
	}
	return nil
}

func rejectCLIOnlyInstall(install, cliOnly bool) error {
	if install && cliOnly {
		return errors.New("CLI-only in-place install is not yet safe on both Linux and Windows; no Desktop installer will be launched. Use xd update --cli-only --download for a verified staged package")
	}
	return nil
}
