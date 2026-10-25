package update

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"debug/buildinfo"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	cliOnlyMaxBinaryBytes  int64 = 96 << 20
	cliOnlyMaxArchiveBytes int64 = 256 << 20
)

func CLIOnlyAssetName(goos, goarch string) (string, error) {
	if goarch != "amd64" {
		return "", fmt.Errorf("CLI-only updater has no verified %s/%s release archive", goos, goarch)
	}
	switch goos {
	case "linux":
		return "xdrive-backup-linux-amd64.tar.gz", nil
	case "windows":
		return "xdrive-backup-windows-amd64.zip", nil
	default:
		return "", fmt.Errorf("CLI-only updater has no verified %s/%s release archive", goos, goarch)
	}
}

func CheckCLIOnlyTargetFromSource(ctx context.Context, current, channel, source, goos, goarch string) (Result, error) {
	name, err := CLIOnlyAssetName(goos, goarch)
	if err != nil {
		return Result{Current: current}, err
	}
	return CheckAssetTargetFromSource(ctx, current, name, channel, source)
}

// DownloadVerifiedCLIOnly reuses the same release+SHA-256 verifier as Desktop,
// then independently checks that the archive contains exactly the original
// xd and Agent Go binaries. No extraction or executable install happens here.
func DownloadVerifiedCLIOnly(ctx context.Context, checker Checker, result Result, dir string, progress ProgressFunc) (string, error) {
	// Validate the asset name BEFORE the downloader joins it to the cache
	// directory. Even malformed release metadata must never create an
	// arbitrary filename outside the user-owned staging cache.
	switch result.Asset.Name {
	case "xdrive-backup-linux-amd64.tar.gz", "xdrive-backup-windows-amd64.zip":
	default:
		return "", fmt.Errorf("unexpected CLI-only release asset name %q", result.Asset.Name)
	}
	path, err := DownloadVerifiedWithProgress(ctx, checker, result, dir, progress)
	if err != nil {
		return "", err
	}
	if err := ValidateCLIOnlyArchive(path, result.Asset.Name); err != nil {
		_ = os.Remove(path) // reject even a SHA-matching release with a wrong payload layout
		return "", fmt.Errorf("rejected CLI-only release archive: %w", err)
	}
	return path, nil
}

// ValidateCLIOnlyArchive is a strict, read-only archive preflight. It rejects
// path traversal, extra files (especially Electron/Desktop), links, duplicate
// names, oversized members, and wrong-platform/wrong-package Go binaries.
func ValidateCLIOnlyArchive(path, assetName string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > cliOnlyMaxArchiveBytes {
		return errors.New("CLI-only archive is linked, empty or exceeds the verified size limit")
	}
	switch assetName {
	case "xdrive-backup-linux-amd64.tar.gz":
		return validateCLIOnlyTar(path)
	case "xdrive-backup-windows-amd64.zip":
		return validateCLIOnlyZIP(path)
	default:
		return fmt.Errorf("unexpected CLI-only archive name %q", assetName)
	}
}

func validateCLIOnlyTar(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	expected := map[string]bool{
		"xdrive-backup/":                            false,
		"xdrive-backup/README.md":                   false,
		"xdrive-backup/xd":                          false,
		"xdrive-backup/xdrive-agent":                false,
		"xdrive-backup/xdrive-backup-agent.service": false,
	}
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read CLI-only tar header: %w", err)
		}
		seen, ok := expected[h.Name]
		if !ok || seen {
			return fmt.Errorf("unexpected or duplicate CLI-only tar member %q", h.Name)
		}
		expected[h.Name] = true
		if h.Name == "xdrive-backup/" {
			if h.Typeflag != tar.TypeDir {
				return errors.New("CLI-only tar root must be a directory")
			}
			continue
		}
		if h.Typeflag != tar.TypeReg && h.Typeflag != tar.TypeRegA {
			return fmt.Errorf("CLI-only tar member %q must be a regular file", h.Name)
		}
		if h.Size < 0 || h.Size > cliOnlyMaxBinaryBytes {
			return fmt.Errorf("CLI-only tar member %q exceeds size limit", h.Name)
		}
		if strings.HasSuffix(h.Name, "/xd") || strings.HasSuffix(h.Name, "/xdrive-agent") {
			if err := checkCLIOnlyGoBinary(tr, h.Size, "linux", "amd64", strings.TrimPrefix(h.Name, "xdrive-backup/")); err != nil {
				return err
			}
		}
	}
	for name, present := range expected {
		if !present {
			return fmt.Errorf("CLI-only tar missing required member %q", name)
		}
	}
	return nil
}

func validateCLIOnlyZIP(path string) error {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return err
	}
	defer zr.Close()
	// Old published CLI-only ZIPs have the original three members.
	// Newer releases may also contain the reviewed Windows user-login helper
	// together with its instructions; neither is an executable uploader.
	expected := map[string]bool{
		"xdrive-backup/README.md":                     false,
		"xdrive-backup/xd.exe":                        false,
		"xdrive-backup/xdrive-agent.exe":              false,
		"xdrive-backup/WINDOWS_TASK.md":               false,
		"xdrive-backup/install-backup-agent-task.ps1": false,
	}
	for _, member := range zr.File {
		seen, ok := expected[member.Name]
		if !ok || seen {
			return fmt.Errorf("unexpected or duplicate CLI-only zip member %q", member.Name)
		}
		expected[member.Name] = true
		if !member.Mode().IsRegular() || member.Flags&1 != 0 ||
			(member.Method != zip.Store && member.Method != zip.Deflate) ||
			member.UncompressedSize64 > uint64(cliOnlyMaxBinaryBytes) {
			return fmt.Errorf("unsafe CLI-only zip member %q", member.Name)
		}
		if strings.HasSuffix(member.Name, "/xd.exe") || strings.HasSuffix(member.Name, "/xdrive-agent.exe") {
			reader, err := member.Open()
			if err != nil {
				return err
			}
			err = checkCLIOnlyGoBinary(reader, int64(member.UncompressedSize64), "windows", "amd64", strings.TrimPrefix(member.Name, "xdrive-backup/"))
			closeErr := reader.Close()
			if err != nil {
				return err
			}
			if closeErr != nil {
				return closeErr
			}
		}
	}
	for _, name := range []string{
		"xdrive-backup/README.md",
		"xdrive-backup/xd.exe",
		"xdrive-backup/xdrive-agent.exe",
	} {
		if !expected[name] {
			return fmt.Errorf("CLI-only zip missing required member %q", name)
		}
	}
	// Reject a half-updated ZIP: docs and the optional helper move together.
	if expected["xdrive-backup/WINDOWS_TASK.md"] !=
		expected["xdrive-backup/install-backup-agent-task.ps1"] {
		return errors.New("CLI-only zip has an incomplete Windows login-task helper")
	}
	return nil
}

func checkCLIOnlyGoBinary(reader io.Reader, size int64, goos, goarch, name string) error {
	if size < 1 || size > cliOnlyMaxBinaryBytes {
		return fmt.Errorf("invalid CLI-only Go executable size for %s", name)
	}
	payload, err := io.ReadAll(io.LimitReader(reader, cliOnlyMaxBinaryBytes+1))
	if err != nil {
		return err
	}
	if int64(len(payload)) != size {
		return fmt.Errorf("truncated CLI-only Go executable %s", name)
	}
	info, err := buildinfo.Read(bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("invalid Go build information for %s: %w", name, err)
	}
	binaryName := strings.TrimSuffix(name, ".exe")
	if binaryName != "xd" && binaryName != "xdrive-agent" {
		return fmt.Errorf("unexpected Go executable name %q", name)
	}
	if info.Path != "github.com/lazyxu/xdrive/cmd/"+binaryName {
		return fmt.Errorf("CLI-only executable %s has wrong Go package path %q", name, info.Path)
	}
	var osOK, archOK bool
	for _, setting := range info.Settings {
		if setting.Key == "GOOS" && setting.Value == goos {
			osOK = true
		}
		if setting.Key == "GOARCH" && setting.Value == goarch {
			archOK = true
		}
	}
	if !osOK || !archOK {
		return fmt.Errorf("CLI-only executable %s is not built for %s/%s", name, goos, goarch)
	}
	return nil
}

// CLIOnlyDownloadDir remains outside any installed executable directory.
func CLIOnlyDownloadDir(cacheDir, latest string) (string, error) {
	if len(latest) < 1 || len(latest) > 80 {
		return "", errors.New("invalid CLI-only release version for download cache")
	}
	for _, ch := range latest {
		if (ch < 'a' || ch > 'z') && (ch < 'A' || ch > 'Z') &&
			(ch < '0' || ch > '9') && ch != '-' && ch != '_' && ch != '.' {
			return "", errors.New("invalid CLI-only release version for download cache")
		}
	}
	if latest == "." || latest == ".." {
		return "", errors.New("invalid CLI-only release version for download cache")
	}
	return filepath.Join(cacheDir, "xdrive", "updates", "cli-only", latest), nil
}
