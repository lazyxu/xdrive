package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ListenAddr                   string
	DatabaseURL                  string
	JWTSecret                    string
	AccessTokenTTL               time.Duration
	RefreshTokenTTL              time.Duration
	StorageRoot                  string
	AllowedOrigin                string
	MaxUploadBytes               int64
	ConnectorSecretActiveVersion string
	ConnectorSecretKeys          string
	ConnectorSecretLegacyKey     string
}

func Load() (Config, error) {
	accessTTL := 15 * time.Minute
	if legacy := strings.TrimSpace(os.Getenv("XD_JWT_TTL")); legacy != "" && strings.TrimSpace(os.Getenv("XD_ACCESS_TOKEN_TTL")) == "" {
		d, err := time.ParseDuration(legacy)
		if err != nil || d <= 0 {
			return Config{}, fmt.Errorf("invalid XD_JWT_TTL %q", legacy)
		}
		accessTTL = d
	}
	cfg := Config{
		ListenAddr:                   env("XD_LISTEN_ADDR", ":8080"),
		DatabaseURL:                  env("XD_DATABASE_URL", "postgres://xdrive:xdrive@localhost:5432/xdrive?sslmode=disable"),
		JWTSecret:                    os.Getenv("XD_JWT_SECRET"),
		AccessTokenTTL:               accessTTL,
		RefreshTokenTTL:              30 * 24 * time.Hour,
		StorageRoot:                  env("XD_STORAGE_ROOT", "./data"),
		AllowedOrigin:                env("XD_ALLOWED_ORIGIN", "http://localhost:5173"),
		MaxUploadBytes:               20 << 30,
		ConnectorSecretActiveVersion: strings.TrimSpace(os.Getenv("XD_CONNECTOR_SECRET_ACTIVE_VERSION")),
		ConnectorSecretKeys:          strings.TrimSpace(os.Getenv("XD_CONNECTOR_SECRET_KEYS")),
		ConnectorSecretLegacyKey:     strings.TrimSpace(os.Getenv("XD_CONNECTOR_SECRET_KEY")),
	}
	if strings.TrimSpace(cfg.JWTSecret) == "" {
		return Config{}, fmt.Errorf("XD_JWT_SECRET is required")
	}
	if v := os.Getenv("XD_ACCESS_TOKEN_TTL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 {
			return Config{}, fmt.Errorf("invalid XD_ACCESS_TOKEN_TTL %q", v)
		}
		cfg.AccessTokenTTL = d
	}
	if v := os.Getenv("XD_REFRESH_TOKEN_TTL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 {
			return Config{}, fmt.Errorf("invalid XD_REFRESH_TOKEN_TTL %q", v)
		}
		cfg.RefreshTokenTTL = d
	}
	if v := os.Getenv("XD_MAX_UPLOAD_BYTES"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n <= 0 {
			return Config{}, fmt.Errorf("invalid XD_MAX_UPLOAD_BYTES %q", v)
		}
		cfg.MaxUploadBytes = n
	}
	return cfg, nil
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
