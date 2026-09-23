package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ListenAddr     string
	DatabaseURL    string
	JWTSecret      string
	JWTTTL         time.Duration
	StorageRoot    string
	AllowedOrigin  string
	MaxUploadBytes int64
}

func Load() (Config, error) {
	cfg := Config{
		ListenAddr:     env("XD_LISTEN_ADDR", ":8080"),
		DatabaseURL:    env("XD_DATABASE_URL", "postgres://xdrive:xdrive@localhost:5432/xdrive?sslmode=disable"),
		JWTSecret:      os.Getenv("XD_JWT_SECRET"),
		StorageRoot:    env("XD_STORAGE_ROOT", "./data"),
		AllowedOrigin:  env("XD_ALLOWED_ORIGIN", "http://localhost:5173"),
		JWTTTL:         24 * time.Hour,
		MaxUploadBytes: 20 << 30,
	}
	if strings.TrimSpace(cfg.JWTSecret) == "" {
		return Config{}, fmt.Errorf("XD_JWT_SECRET is required")
	}
	if v := os.Getenv("XD_JWT_TTL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 {
			return Config{}, fmt.Errorf("invalid XD_JWT_TTL %q", v)
		}
		cfg.JWTTTL = d
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
