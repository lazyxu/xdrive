package userconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/secretstore"
)

type Config struct {
	Server             string `json:"server"`
	SessionID          string `json:"session_id,omitempty"`
	Username           string `json:"username"`
	Role               string `json:"role,omitempty"`
	MustChangePassword bool   `json:"must_change_password,omitempty"`
	MountPath          string `json:"mount_path,omitempty"`
	Paused             bool   `json:"paused,omitempty"`

	// Legacy plaintext fields are retained only for one-time migration.
	Token            string    `json:"token,omitempty"`
	AccessToken      string    `json:"access_token,omitempty"`
	RefreshToken     string    `json:"refresh_token,omitempty"`
	AccessExpiresAt  time.Time `json:"access_expires_at,omitempty"`
	RefreshExpiresAt time.Time `json:"refresh_expires_at,omitempty"`
}

func Dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "xdrive"), nil
}

func Path() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}

func Load() (Config, error) {
	cfg, err := loadRaw()
	if err != nil {
		return Config{}, err
	}
	cfg.Server = strings.TrimRight(strings.TrimSpace(cfg.Server), "/")
	cfg.Username = strings.TrimSpace(cfg.Username)
	if cfg.AccessToken == "" {
		cfg.AccessToken = cfg.Token
	}

	if cfg.SessionID == "" && (cfg.AccessToken != "" || cfg.RefreshToken != "") {
		cfg.SessionID = uuid.NewString()
	}
	if cfg.AccessToken != "" || cfg.RefreshToken != "" {
		dir, err := Dir()
		if err != nil {
			return Config{}, err
		}
		creds := secretstore.Credentials{
			RefreshToken:     cfg.RefreshToken,
			RefreshExpiresAt: cfg.RefreshExpiresAt,
			AccessToken:      cfg.AccessToken,
			AccessExpiresAt:  cfg.AccessExpiresAt,
		}
		if err := secretstore.Save(dir, cfg.SessionID, credentialLabel(cfg), creds); err != nil {
			return Config{}, fmt.Errorf("migrate xDrive credentials: %w", err)
		}
		clearLegacySecrets(&cfg)
		if err := writeConfig(cfg); err != nil {
			return Config{}, err
		}
	}
	if cfg.Server == "" || cfg.SessionID == "" {
		return Config{}, fmt.Errorf("invalid local config; please log in again")
	}
	return cfg, nil
}

func Save(cfg Config) error {
	cfg.Server = strings.TrimRight(strings.TrimSpace(cfg.Server), "/")
	cfg.Username = strings.TrimSpace(cfg.Username)
	if cfg.Server == "" || cfg.SessionID == "" {
		return fmt.Errorf("server and session id are required")
	}
	if cfg.MountPath != "" {
		abs, err := filepath.Abs(cfg.MountPath)
		if err != nil {
			return err
		}
		cfg.MountPath = filepath.Clean(abs)
	}
	clearLegacySecrets(&cfg)
	return writeConfig(cfg)
}

func writeConfig(cfg Config) error {
	dir, err := Dir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	_ = os.Chmod(dir, 0o700)
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "config.json")
	tmp, err := os.CreateTemp(dir, "config-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(b); err != nil {
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

func loadRaw() (Config, error) {
	var cfg Config
	path, err := Path()
	if err != nil {
		return cfg, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cfg, fmt.Errorf("not logged in: %w", err)
		}
		return cfg, err
	}
	if err := json.Unmarshal(b, &cfg); err != nil {
		return cfg, fmt.Errorf("read xDrive config: %w", err)
	}
	return cfg, nil
}

func Remove() error {
	cfg, rawErr := loadRaw()
	dir, dirErr := Dir()
	if rawErr == nil && dirErr == nil && cfg.SessionID != "" {
		_ = secretstore.Delete(dir, cfg.SessionID)
	}
	path, err := Path()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func EffectiveMountPath(cfg Config) (string, error) {
	if strings.TrimSpace(cfg.MountPath) != "" {
		return filepath.Abs(cfg.MountPath)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "xDrive"), nil
}

func (cfg *Config) ApplyAuth(resp client.AuthResponse, _ bool) error {
	tokens := resp.Session(time.Now())
	if cfg.SessionID == "" {
		cfg.SessionID = uuid.NewString()
	}
	cfg.Username = resp.Username
	cfg.Role = resp.Role
	cfg.MustChangePassword = resp.MustChangePassword
	dir, err := Dir()
	if err != nil {
		return err
	}
	if err := secretstore.Save(dir, cfg.SessionID, credentialLabel(*cfg), secretstore.Credentials{
		RefreshToken:     tokens.RefreshToken,
		RefreshExpiresAt: tokens.RefreshExpiresAt,
	}); err != nil {
		return fmt.Errorf("save xDrive credential: %w", err)
	}
	clearLegacySecrets(cfg)
	return nil
}

func NewClient(cfg Config) (*client.Client, error) {
	dir, err := Dir()
	if err != nil {
		return nil, err
	}
	creds, err := secretstore.Load(dir, cfg.SessionID)
	if err != nil {
		return nil, fmt.Errorf("load xDrive credential: %w; please log in again", err)
	}
	tokens := client.SessionTokens{
		AccessToken:      creds.AccessToken,
		RefreshToken:     creds.RefreshToken,
		AccessExpiresAt:  creds.AccessExpiresAt,
		RefreshExpiresAt: creds.RefreshExpiresAt,
	}
	saveTokens := func(next client.SessionTokens) error {
		return secretstore.Save(dir, cfg.SessionID, credentialLabel(cfg), secretstore.Credentials{
			RefreshToken:     next.RefreshToken,
			RefreshExpiresAt: next.RefreshExpiresAt,
		})
	}
	loadTokens := func() (client.SessionTokens, error) {
		latest, err := secretstore.Load(dir, cfg.SessionID)
		if err != nil {
			return client.SessionTokens{}, err
		}
		return client.SessionTokens{
			AccessToken:      latest.AccessToken,
			RefreshToken:     latest.RefreshToken,
			AccessExpiresAt:  latest.AccessExpiresAt,
			RefreshExpiresAt: latest.RefreshExpiresAt,
		}, nil
	}
	return client.NewManagedSession(cfg.Server, tokens, saveTokens, loadTokens), nil
}

func CredentialBackend(cfg Config) string {
	dir, err := Dir()
	if err != nil || cfg.SessionID == "" {
		return "unavailable"
	}
	return secretstore.Backend(dir, cfg.SessionID)
}

func credentialLabel(cfg Config) string {
	if cfg.Username == "" {
		return "xDrive"
	}
	return "xDrive " + cfg.Username + " @ " + cfg.Server
}

func clearLegacySecrets(cfg *Config) {
	cfg.Token = ""
	cfg.AccessToken = ""
	cfg.RefreshToken = ""
	cfg.AccessExpiresAt = time.Time{}
	cfg.RefreshExpiresAt = time.Time{}
}
