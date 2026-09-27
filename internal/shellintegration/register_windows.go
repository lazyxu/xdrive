//go:build windows

package shellintegration

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const explorerShellBase = `Software\Classes\AllFilesystemObjects\shell`

var (
	shell32            = windows.NewLazySystemDLL("shell32.dll")
	procSHChangeNotify = shell32.NewProc("SHChangeNotify")
)

func explorerIntegrationEnabled() (string, bool) {
	executable, err := os.Executable()
	if err != nil {
		return "", false
	}
	executable = filepath.Clean(executable)
	if !strings.EqualFold(filepath.Base(executable), "xdrive-agent.exe") {
		return "", false
	}
	return executable, true
}

func RegisterExplorerActions(root string) error {
	executable, enabled := explorerIntegrationEnabled()
	if !enabled {
		return nil
	}
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "" || root == "." {
		return fmt.Errorf("xDrive Explorer integration requires a sync root")
	}
	if err := UnregisterExplorerActions(); err != nil {
		return err
	}
	for _, spec := range ExplorerVerbSpecs(root, executable) {
		if err := writeExplorerVerb(spec); err != nil {
			_ = UnregisterExplorerActions()
			return err
		}
	}
	notifyExplorerAssociationsChanged()
	return nil
}

func writeExplorerVerb(spec ExplorerVerbSpec) error {
	keyPath := explorerShellBase + `\` + spec.Key
	key, _, err := registry.CreateKey(registry.CURRENT_USER, keyPath, registry.ALL_ACCESS)
	if err != nil {
		return fmt.Errorf("create Explorer verb %s: %w", spec.Key, err)
	}
	defer key.Close()
	for name, value := range map[string]string{
		"MUIVerb":          spec.Label,
		"AppliesTo":        spec.AppliesTo,
		"MultiSelectModel": "Single",
		"Position":         "Bottom",
	} {
		if err := key.SetStringValue(name, value); err != nil {
			return fmt.Errorf("write Explorer verb %s/%s: %w", spec.Key, name, err)
		}
	}
	command, _, err := registry.CreateKey(registry.CURRENT_USER, keyPath+`\command`, registry.ALL_ACCESS)
	if err != nil {
		return fmt.Errorf("create Explorer command %s: %w", spec.Key, err)
	}
	defer command.Close()
	if err := command.SetStringValue("", spec.Command); err != nil {
		return fmt.Errorf("write Explorer command %s: %w", spec.Key, err)
	}
	return nil
}

func UnregisterExplorerActions() error {
	if _, enabled := explorerIntegrationEnabled(); !enabled {
		return nil
	}
	var firstErr error
	for _, keyName := range []string{VerbKeepLocalKey, VerbReleaseSpaceKey} {
		keyPath := explorerShellBase + `\` + keyName
		if err := deleteRegistryKey(keyPath + `\command`); err != nil && firstErr == nil {
			firstErr = err
		}
		if err := deleteRegistryKey(keyPath); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	notifyExplorerAssociationsChanged()
	return firstErr
}

func deleteRegistryKey(path string) error {
	err := registry.DeleteKey(registry.CURRENT_USER, path)
	if err == nil || errors.Is(err, windows.ERROR_FILE_NOT_FOUND) || errors.Is(err, windows.ERROR_PATH_NOT_FOUND) {
		return nil
	}
	return fmt.Errorf("delete registry key %s: %w", path, err)
}

func notifyExplorerAssociationsChanged() {
	const shcneAssocChanged = 0x08000000
	const shcnfIDList = 0x0000
	_, _, _ = procSHChangeNotify.Call(shcneAssocChanged, shcnfIDList, 0, 0)
}
