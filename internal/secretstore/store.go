package secretstore

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var ErrNotFound = errors.New("xDrive credential not found")

type Credentials struct {
	RefreshToken     string    `json:"refresh_token"`
	RefreshExpiresAt time.Time `json:"refresh_expires_at,omitempty"`
	AccessToken      string    `json:"access_token,omitempty"`
	AccessExpiresAt  time.Time `json:"access_expires_at,omitempty"`
}

func validateSessionID(sessionID string) error {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" || strings.ContainsAny(sessionID, "/\\") || sessionID == "." || sessionID == ".." {
		return fmt.Errorf("invalid credential session id")
	}
	return nil
}

func marshalCredentials(creds Credentials) ([]byte, error) {
	if strings.TrimSpace(creds.RefreshToken) == "" && strings.TrimSpace(creds.AccessToken) == "" {
		return nil, fmt.Errorf("credential has no token")
	}
	return json.Marshal(creds)
}

func unmarshalCredentials(data []byte) (Credentials, error) {
	var creds Credentials
	if err := json.Unmarshal(data, &creds); err != nil {
		return creds, fmt.Errorf("decode credential: %w", err)
	}
	if strings.TrimSpace(creds.RefreshToken) == "" && strings.TrimSpace(creds.AccessToken) == "" {
		return creds, ErrNotFound
	}
	return creds, nil
}

func credentialDir(configDir string) string {
	return filepath.Join(configDir, "credentials")
}

func fallbackPath(configDir, sessionID string) (string, error) {
	if err := validateSessionID(sessionID); err != nil {
		return "", err
	}
	return filepath.Join(credentialDir(configDir), sessionID+".json"), nil
}

func writeAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	_ = os.Chmod(dir, 0o700)
	tmp, err := os.CreateTemp(dir, ".credential-*.tmp")
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
	if err := os.Rename(tmpName, path); err != nil {
		return err
	}
	_ = os.Chmod(path, 0o600)
	return nil
}

func saveFallback(configDir, sessionID string, creds Credentials) error {
	path, err := fallbackPath(configDir, sessionID)
	if err != nil {
		return err
	}
	data, err := marshalCredentials(creds)
	if err != nil {
		return err
	}
	return writeAtomic(path, data)
}

func loadFallback(configDir, sessionID string) (Credentials, error) {
	path, err := fallbackPath(configDir, sessionID)
	if err != nil {
		return Credentials{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Credentials{}, ErrNotFound
		}
		return Credentials{}, err
	}
	return unmarshalCredentials(data)
}

func deleteFallback(configDir, sessionID string) error {
	path, err := fallbackPath(configDir, sessionID)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
