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
)

type Config struct {
	Server           string    `json:"server"`
	Token            string    `json:"token,omitempty"`
	AccessToken      string    `json:"access_token,omitempty"`
	RefreshToken     string    `json:"refresh_token,omitempty"`
	AccessExpiresAt  time.Time `json:"access_expires_at,omitempty"`
	RefreshExpiresAt time.Time `json:"refresh_expires_at,omitempty"`
	SessionID        string    `json:"session_id,omitempty"`
	Username         string    `json:"username"`
	MountPath        string    `json:"mount_path,omitempty"`
	Paused           bool      `json:"paused,omitempty"`
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
	if cfg.AccessToken == "" {
		cfg.AccessToken = cfg.Token
	}
	if cfg.Token == "" {
		cfg.Token = cfg.AccessToken
	}
	if strings.TrimSpace(cfg.Server) == "" || strings.TrimSpace(cfg.AccessToken) == "" {
		return cfg, fmt.Errorf("invalid local config; please log in again")
	}
	return cfg, nil
}

func Save(cfg Config) error {
	cfg.Server = strings.TrimRight(strings.TrimSpace(cfg.Server), "/")
	cfg.Username = strings.TrimSpace(cfg.Username)
	if cfg.AccessToken == "" {
		cfg.AccessToken = cfg.Token
	}
	if cfg.Token == "" {
		cfg.Token = cfg.AccessToken
	}
	if cfg.Server == "" || strings.TrimSpace(cfg.AccessToken) == "" {
		return fmt.Errorf("server and access token are required")
	}
	if cfg.MountPath != "" {
		abs, err := filepath.Abs(cfg.MountPath)
		if err != nil {
			return err
		}
		cfg.MountPath = filepath.Clean(abs)
	}
	dir, err := Dir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
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
	return os.Rename(tmpName, path)
}

func Remove() error {
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

func (cfg *Config) ApplyAuth(resp client.AuthResponse, newSession bool) {
	tokens := resp.Session(time.Now())
	cfg.Token = tokens.AccessToken
	cfg.AccessToken = tokens.AccessToken
	cfg.RefreshToken = tokens.RefreshToken
	cfg.AccessExpiresAt = tokens.AccessExpiresAt
	cfg.RefreshExpiresAt = tokens.RefreshExpiresAt
	cfg.Username = resp.Username
	if newSession || cfg.SessionID == "" {
		cfg.SessionID = uuid.NewString()
	}
}

func NewClient(cfg Config) *client.Client {
	access := cfg.AccessToken
	if access == "" {
		access = cfg.Token
	}
	tokens := client.SessionTokens{
		AccessToken:      access,
		RefreshToken:     cfg.RefreshToken,
		AccessExpiresAt:  cfg.AccessExpiresAt,
		RefreshExpiresAt: cfg.RefreshExpiresAt,
	}
	return client.NewSession(cfg.Server, tokens, func(next client.SessionTokens) error {
		latest, err := Load()
		if err != nil {
			latest = cfg
		}
		latest.Token = next.AccessToken
		latest.AccessToken = next.AccessToken
		latest.RefreshToken = next.RefreshToken
		latest.AccessExpiresAt = next.AccessExpiresAt
		latest.RefreshExpiresAt = next.RefreshExpiresAt
		return Save(latest)
	})
}
