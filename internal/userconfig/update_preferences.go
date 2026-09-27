package userconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	UpdateModeManual   = "manual"
	UpdateModeCheck    = "check"
	UpdateModeDownload = "download"
	UpdateModeInstall  = "install"
)

type UpdatePreferences struct {
	Mode string `json:"mode"`
}

func DefaultUpdatePreferences() UpdatePreferences {
	return UpdatePreferences{Mode: UpdateModeManual}
}

func NormalizeUpdateMode(mode string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "", UpdateModeManual:
		return UpdateModeManual, nil
	case UpdateModeCheck:
		return UpdateModeCheck, nil
	case UpdateModeDownload:
		return UpdateModeDownload, nil
	case UpdateModeInstall:
		return UpdateModeInstall, nil
	default:
		return "", fmt.Errorf("invalid update mode %q", mode)
	}
}

func UpdatePreferencesPath() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "update-settings.json"), nil
}

func LoadUpdatePreferences() (UpdatePreferences, error) {
	path, err := UpdatePreferencesPath()
	if err != nil {
		return UpdatePreferences{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return DefaultUpdatePreferences(), nil
		}
		return UpdatePreferences{}, err
	}
	var prefs UpdatePreferences
	if err := json.Unmarshal(data, &prefs); err != nil {
		return UpdatePreferences{}, fmt.Errorf("read update settings: %w", err)
	}
	mode, err := NormalizeUpdateMode(prefs.Mode)
	if err != nil {
		return UpdatePreferences{}, err
	}
	prefs.Mode = mode
	return prefs, nil
}

func SaveUpdatePreferences(prefs UpdatePreferences) error {
	mode, err := NormalizeUpdateMode(prefs.Mode)
	if err != nil {
		return err
	}
	prefs.Mode = mode

	dir, err := Dir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	_ = os.Chmod(dir, 0o700)

	data, err := json.MarshalIndent(prefs, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	tmp, err := os.CreateTemp(dir, "update-settings-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	path := filepath.Join(dir, "update-settings.json")
	if err := os.Rename(tmpName, path); err != nil {
		return err
	}
	_ = os.Chmod(path, 0o600)
	return nil
}
