//go:build windows

package update

import (
	"context"
	"fmt"
	"os"
	"os/exec"
)

func platformAssetName() string { return "xDriveSetup-amd64.exe" }

func installDownloaded(_ context.Context, path string) error {
	// Detach from the caller context. The caller exits immediately after this
	// returns; PowerShell waits briefly so Windows has released the running
	// xd/agent binary before Inno Setup replaces it.
	script := `Start-Sleep -Seconds 2; Start-Process -FilePath $env:XDRIVE_UPDATE_INSTALLER -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-'`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	cmd.Env = append(os.Environ(), "XDRIVE_UPDATE_INSTALLER="+path)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start Windows updater: %w", err)
	}
	return nil
}
