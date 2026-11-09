//go:build windows

package update

import (
	"bytes"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

//go:embed windows_upgrade_transaction.ps1
var windowsUpgradeTransactionScript string

//go:embed windows_legacy_cleanup.ps1
var windowsLegacyCleanupScript string

//go:embed windows_process_scope.ps1
var windowsProcessScopeScript string

func platformAssetName() string { return "xDriveSetup-amd64.exe" }

func writeWindowsUpdateScripts(dir string) (transactionPath, cleanupPath, statusPath, logPath string, err error) {
	if err = os.MkdirAll(dir, 0o700); err != nil {
		return "", "", "", "", err
	}
	transactionPath = filepath.Join(dir, "windows-upgrade-transaction.ps1")
	cleanupPath = filepath.Join(dir, "windows-legacy-cleanup.ps1")
	processScopePath := filepath.Join(dir, "windows_process_scope.ps1")
	statusPath = filepath.Join(dir, "last-transaction.json")
	logPath = filepath.Join(dir, "last-transaction.log")
	if err = os.WriteFile(transactionPath, []byte(windowsUpgradeTransactionScript), 0o600); err != nil {
		return "", "", "", "", err
	}
	if err = os.WriteFile(cleanupPath, []byte(windowsLegacyCleanupScript), 0o600); err != nil {
		return "", "", "", "", err
	}
	if err = os.WriteFile(processScopePath, []byte(windowsProcessScopeScript), 0o600); err != nil {
		return "", "", "", "", err
	}
	return transactionPath, cleanupPath, statusPath, logPath, nil
}

func LastInstallStatus() (InstallStatus, error) {
	cache, err := os.UserCacheDir()
	if err != nil {
		cache = os.TempDir()
	}
	root := filepath.Join(cache, "xdrive", "updates", "transaction")
	statusPath := filepath.Join(root, "last-transaction.json")
	logPath := filepath.Join(root, "last-transaction.log")
	data, err := os.ReadFile(statusPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return InstallStatus{}, fmt.Errorf("no Windows client update transaction has been recorded")
		}
		return InstallStatus{}, err
	}
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	var status InstallStatus
	if err := json.Unmarshal(data, &status); err != nil {
		return InstallStatus{}, fmt.Errorf("decode last Windows update transaction: %w", err)
	}
	status.LogPath = logPath
	return status, nil
}

func installDownloaded(_ context.Context, path string, result Result) (string, error) {
	// The installer is detached from the Agent. Pin the verified package
	// identity as arguments; the transaction independently rechecks those
	// bytes and its Authenticode publisher before running the executable.
	info, err := os.Lstat(path)
	if err != nil {
		return "", fmt.Errorf("stat verified installer: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 {
		return "", fmt.Errorf("installer is not a regular nonempty file")
	}
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	n, copyErr := io.Copy(h, file)
	closeErr := file.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	if n != info.Size() {
		return "", fmt.Errorf("installer changed size during verification")
	}
	digest := hex.EncodeToString(h.Sum(nil))
	if expected, has := assetSHA256(result.Asset); has && expected != digest {
		return "", fmt.Errorf("installer differs from trusted release SHA-256")
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		cache = os.TempDir()
	}
	transactionPath, cleanupPath, statusPath, logPath, err := writeWindowsUpdateScripts(
		filepath.Join(cache, "xdrive", "updates", "transaction"),
	)
	if err != nil {
		return "", fmt.Errorf("prepare Windows update transaction: %w", err)
	}

	cmd := exec.Command(
		"powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy", "Bypass",
		"-WindowStyle", "Hidden",
		"-File", transactionPath,
		"-Installer", path,
		"-ExpectedSHA256", digest,
		"-ExpectedSize", strconv.FormatInt(info.Size(), 10),
		"-TargetVersion", result.Latest,
		"-CurrentVersion", result.Current,
		"-LegacyCleanupScript", cleanupPath,
		"-StatusPath", statusPath,
		"-LogPath", logPath,
	)
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("start Windows update transaction: %w", err)
	}
	return "upgrade transaction started; Desktop and Agent will restart after post-install verification", nil
}
