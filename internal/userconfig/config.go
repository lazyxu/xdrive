package userconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	pathpkg "path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/secretstore"
)

const (
	SyncModeExclude     = "exclude"
	SyncModeAlwaysLocal = "always-local"
)

type SyncRule struct {
	Path string `json:"path"`
	Mode string `json:"mode"`
}

type Config struct {
	Server             string     `json:"server"`
	SessionID          string     `json:"session_id,omitempty"`
	Username           string     `json:"username"`
	Role               string     `json:"role,omitempty"`
	MustChangePassword bool       `json:"must_change_password,omitempty"`
	MountPath          string     `json:"mount_path,omitempty"`
	Paused             bool       `json:"paused,omitempty"`
	SyncRules          []SyncRule `json:"sync_rules,omitempty"`
	CacheLimitBytes    int64      `json:"cache_limit_bytes,omitempty"`

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
	if err := normalizeStoragePolicy(&cfg); err != nil {
		return Config{}, fmt.Errorf("invalid storage policy: %w", err)
	}
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
	if err := normalizeStoragePolicy(&cfg); err != nil {
		return err
	}
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

func normalizeStoragePolicy(cfg *Config) error {
	if cfg.CacheLimitBytes < 0 {
		return fmt.Errorf("cache limit must be zero or greater")
	}
	seen := make(map[string]int)
	rules := make([]SyncRule, 0, len(cfg.SyncRules))
	for _, rule := range cfg.SyncRules {
		clean, err := NormalizeSyncRulePath(rule.Path)
		if err != nil {
			return err
		}
		mode := strings.TrimSpace(rule.Mode)
		if mode != SyncModeExclude && mode != SyncModeAlwaysLocal {
			return fmt.Errorf("invalid sync rule mode %q", rule.Mode)
		}
		key := strings.ToLower(clean)
		if index, ok := seen[key]; ok {
			rules[index] = SyncRule{Path: clean, Mode: mode}
			continue
		}
		seen[key] = len(rules)
		rules = append(rules, SyncRule{Path: clean, Mode: mode})
	}
	sort.Slice(rules, func(i, j int) bool {
		li, lj := strings.ToLower(rules[i].Path), strings.ToLower(rules[j].Path)
		if li == lj {
			return rules[i].Mode < rules[j].Mode
		}
		return li < lj
	})
	for _, rule := range rules {
		if rule.Mode != SyncModeAlwaysLocal {
			continue
		}
		for _, parent := range rules {
			if parent.Mode != SyncModeExclude || strings.EqualFold(parent.Path, rule.Path) {
				continue
			}
			if pathContains(parent.Path, rule.Path) {
				return fmt.Errorf("always-local path %q is inside excluded path %q", rule.Path, parent.Path)
			}
		}
	}
	cfg.SyncRules = rules
	return nil
}

func NormalizeSyncRulePath(value string) (string, error) {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if value == "" {
		return "", fmt.Errorf("sync rule path is required")
	}
	clean := pathpkg.Clean(value)
	if clean == "." || clean == "/" || strings.HasPrefix(clean, "/") ||
		clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("sync rule path must be a relative path inside xDrive")
	}
	if strings.Contains(clean, ":") {
		return "", fmt.Errorf("sync rule path must not contain a drive prefix")
	}
	return strings.Trim(clean, "/"), nil
}

func pathContains(parent, child string) bool {
	parent = strings.ToLower(strings.Trim(parent, "/"))
	child = strings.ToLower(strings.Trim(child, "/"))
	return child == parent || strings.HasPrefix(child, parent+"/")
}

func (cfg Config) StoragePolicyKey() string {
	var b strings.Builder
	fmt.Fprintf(&b, "cache=%d;", cfg.CacheLimitBytes)
	for _, rule := range cfg.SyncRules {
		fmt.Fprintf(&b, "%s=%s;", strings.ToLower(rule.Path), rule.Mode)
	}
	return b.String()
}

func clearLegacySecrets(cfg *Config) {
	cfg.Token = ""
	cfg.AccessToken = ""
	cfg.RefreshToken = ""
	cfg.AccessExpiresAt = time.Time{}
	cfg.RefreshExpiresAt = time.Time{}
}
