package sourceagentconfig

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

const configDirEnv = "XD_SOURCE_AGENT_CONFIG_DIR"

type Config struct {
	Server             string `json:"server"`
	SessionID          string `json:"session_id"`
	Username           string `json:"username"`
	MustChangePassword bool   `json:"must_change_password,omitempty"`
	SourceID           uint64 `json:"source_id,omitempty"`
	PersonalRoot       string `json:"personal_root,omitempty"`
	PersonalRootID     string `json:"personal_root_id,omitempty"`
	SharedRoot         string `json:"shared_root,omitempty"`
	SharedRootID       string `json:"shared_root_id,omitempty"`
}

func Dir() (string, error) {
	if value := strings.TrimSpace(os.Getenv(configDirEnv)); value != "" {
		return filepath.Abs(value)
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "xdrive-source-agent"), nil
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
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cfg, fmt.Errorf("source agent is not configured: %w", err)
		}
		return cfg, err
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, fmt.Errorf("read source-agent config: %w", err)
	}
	if err := normalize(&cfg); err != nil {
		return cfg, err
	}
	if cfg.Server == "" || cfg.SessionID == "" {
		return cfg, fmt.Errorf("invalid source-agent config; please log in again")
	}
	return cfg, nil
}

func Save(cfg Config) error {
	if err := normalize(&cfg); err != nil {
		return err
	}
	if cfg.Server == "" || cfg.SessionID == "" {
		return fmt.Errorf("server and session id are required")
	}
	dir, err := Dir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	_ = os.Chmod(dir, 0o700)
	data, err := json.MarshalIndent(cfg, "", "  ")
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

func Remove() error {
	cfg, loadErr := Load()
	dir, dirErr := Dir()
	if loadErr == nil && dirErr == nil && cfg.SessionID != "" {
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

func (cfg *Config) ApplyAuth(resp client.AuthResponse) error {
	if cfg.SessionID == "" {
		cfg.SessionID = uuid.NewString()
	}
	cfg.Username = strings.TrimSpace(resp.Username)
	cfg.MustChangePassword = resp.MustChangePassword
	dir, err := Dir()
	if err != nil {
		return err
	}
	tokens := resp.Session(time.Now())
	return secretstore.Save(dir, cfg.SessionID, credentialLabel(*cfg), secretstore.Credentials{
		RefreshToken:     tokens.RefreshToken,
		RefreshExpiresAt: tokens.RefreshExpiresAt,
		AccessToken:      tokens.AccessToken,
		AccessExpiresAt:  tokens.AccessExpiresAt,
	})
}

func NewClient(cfg Config) (*client.Client, error) {
	dir, err := Dir()
	if err != nil {
		return nil, err
	}
	creds, err := secretstore.Load(dir, cfg.SessionID)
	if err != nil {
		return nil, fmt.Errorf("load source-agent credential: %w; please log in again", err)
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
			AccessToken:      next.AccessToken,
			AccessExpiresAt:  next.AccessExpiresAt,
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

func (cfg Config) ReadyForRun() error {
	if cfg.SourceID == 0 {
		return fmt.Errorf("source_id is not configured; run setup first")
	}
	if cfg.PersonalRoot == "" && cfg.SharedRoot == "" {
		return fmt.Errorf("at least one Synology Photos root is required")
	}
	if cfg.PersonalRoot != "" && cfg.PersonalRootID == "" {
		return fmt.Errorf("personal root identity is missing; run setup again")
	}
	if cfg.SharedRoot != "" && cfg.SharedRootID == "" {
		return fmt.Errorf("shared root identity is missing; run setup again")
	}
	return nil
}

func normalize(cfg *Config) error {
	cfg.Server = strings.TrimRight(strings.TrimSpace(cfg.Server), "/")
	cfg.Username = strings.TrimSpace(cfg.Username)
	cfg.SessionID = strings.TrimSpace(cfg.SessionID)
	cfg.PersonalRootID = strings.TrimSpace(cfg.PersonalRootID)
	cfg.SharedRootID = strings.TrimSpace(cfg.SharedRootID)
	var err error
	if cfg.PersonalRoot != "" {
		cfg.PersonalRoot, err = normalizeRoot(cfg.PersonalRoot)
		if err != nil {
			return fmt.Errorf("personal root: %w", err)
		}
	}
	if cfg.SharedRoot != "" {
		cfg.SharedRoot, err = normalizeRoot(cfg.SharedRoot)
		if err != nil {
			return fmt.Errorf("shared root: %w", err)
		}
	}
	if cfg.PersonalRoot != "" && cfg.SharedRoot != "" && rootsOverlap(cfg.PersonalRoot, cfg.SharedRoot) {
		return fmt.Errorf("personal and shared roots must not overlap")
	}
	return nil
}

func normalizeRoot(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	abs, err := filepath.Abs(value)
	if err != nil {
		return "", err
	}
	return filepath.Clean(abs), nil
}

func rootsOverlap(a, b string) bool {
	inside := func(parent, child string) bool {
		rel, err := filepath.Rel(parent, child)
		if err != nil {
			return false
		}
		return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
	}
	return inside(a, b) || inside(b, a)
}

func credentialLabel(cfg Config) string {
	if cfg.Username == "" {
		return "xDrive Source Agent"
	}
	return "xDrive Source Agent " + cfg.Username + " @ " + cfg.Server
}
