package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	xupdate "github.com/lazyxu/xdrive/internal/update"
	"github.com/lazyxu/xdrive/internal/userconfig"
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

func runCLIOnlyUpdate(ctx context.Context, current, channel, source string, download, standalone bool) error {
	check := xupdate.CheckCLIOnlyTargetFromSource
	if standalone {
		check = xupdate.CheckStandaloneCLIOnlyTargetFromSource
	}
	result, err := check(ctx, current, channel, source, runtime.GOOS, runtime.GOARCH)
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
		flag := ""
		if standalone {
			flag = " --standalone"
		}
		fmt.Printf("run: xd update --cli-only%s --download --source %s --channel %s\n", flag, source, channel)
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
	path := ""
	if owner, artifact, ok := verifiedCLIOnlyServerSource(ctx, result, source, runtime.GOOS); ok {
		target := filepath.Join(dir, result.Asset.Name)
		if err := owner.DownloadCurrentReleaseArtifact(ctx, result.Commit, artifact, target); err == nil {
			// The CLI archive validator is stricter than a matching checksum:
			// never install/extract an archive with bad layout or wrong Go binaries.
			if err := xupdate.ValidateCLIOnlyArchive(target, result.Asset.Name); err == nil {
				path = target
			} else {
				_ = os.Remove(target)
			}
		} else if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	if path == "" {
		path, err = xupdate.DownloadVerifiedCLIOnly(ctx, xupdate.DefaultChecker(), result, dir,
			func(event xupdate.ProgressEvent) { fmt.Println(xupdate.FormatProgress(event)) })
		if err != nil {
			return err
		}
	}
	fmt.Printf("SHA-256 verified and CLI-only binary/layout checked: %s\n", path)
	fmt.Println("Only downloaded to the user cache. xd and xdrive-agent were NOT installed, replaced or restarted.")
	fmt.Println("An atomic CLI-only install/rollback transaction is required before --install can be enabled.")
	return nil
}

// matchCLIOnlyServerBundle supports both the original Backup-only pair and
// the separately packaged standalone pair; both require independent GitLab
// SHA-256, exact source, channel and version matching.
// matchCLIOnlyServerBundle requires an independently pinned GitLab checksum
// matching the authenticated Server's exact source Commit and version.
// CLI-only archives remain download-only, never an install permission.
func matchCLIOnlyServerBundle(
	result xupdate.Result, listing client.ReleaseBundleListing, digest, goos string,
) (client.ReleaseBundleArtifact, bool) {
	if len(result.Commit) != 40 || result.Commit != listing.Commit ||
		result.Channel != listing.Channel ||
		!strings.EqualFold(result.Latest, listing.ServerVersion) {
		return client.ReleaseBundleArtifact{}, false
	}
	for _, artifact := range listing.Artifacts {
		if artifact.Platform == "cli" {
			// Preserve the published, named CLI-only archive, not a Desktop
			// installer. Cross-platform packages remain separate artifacts.
			if artifact.Filename == result.Asset.Name &&
				artifact.BuildCommit == result.Commit &&
				artifact.InstallMode == "manual" &&
				strings.EqualFold(artifact.SHA256, digest) &&
				(result.Asset.Size <= 0 || result.Asset.Size == artifact.Size) &&
				((goos == "linux" && (artifact.Filename == "xdrive-backup-linux-amd64.tar.gz" ||
					artifact.Filename == "xdrive-cli-linux-amd64.tar.gz")) ||
					(goos == "windows" && (artifact.Filename == "xdrive-backup-windows-amd64.zip" ||
					artifact.Filename == "xdrive-cli-windows-amd64.zip"))) {
				return artifact, true
			}
		}
	}
	return client.ReleaseBundleArtifact{}, false
}

// verifiedCLIOnlyServerSource is an optional optimization for a logged-in
// GitLab CLI-only update. Both the Server manifest and GitLab's release
// SHA256SUMS must agree before an authenticated package download is attempted.
// No Owner token can be forwarded to GitLab/GitHub mirrors.
func verifiedCLIOnlyServerSource(
	ctx context.Context, result xupdate.Result, source, goos string,
) (*client.Client, client.ReleaseBundleArtifact, bool) {
	if !strings.EqualFold(strings.TrimSpace(source), xupdate.SourceGitLab) ||
		!result.UpdateAvailable || len(result.Commit) != 40 {
		return nil, client.ReleaseBundleArtifact{}, false
	}
	cfg, err := userconfig.Load()
	if err != nil || cfg.SessionInvalid {
		return nil, client.ReleaseBundleArtifact{}, false
	}
	owner, err := userconfig.NewClient(cfg)
	if err != nil {
		return nil, client.ReleaseBundleArtifact{}, false
	}
	probeCtx, stop := context.WithTimeout(ctx, 4*time.Second)
	defer stop()
	listing, err := owner.CurrentReleaseBundle(probeCtx)
	if err != nil || listing.Commit != result.Commit ||
		listing.Channel != result.Channel ||
		!strings.EqualFold(listing.ServerVersion, result.Latest) {
		return nil, client.ReleaseBundleArtifact{}, false
	}
	checkCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	digest, err := xupdate.ResolveReleaseAssetSHA256(checkCtx, result)
	if err != nil {
		return nil, client.ReleaseBundleArtifact{}, false
	}
	artifact, ok := matchCLIOnlyServerBundle(result, listing, digest, goos)
	return owner, artifact, ok
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
