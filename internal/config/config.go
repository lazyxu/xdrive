package config

import (
	"fmt"
	"net/url"
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
	SourceRunFailureRetention    time.Duration
	PhotoPlaceGeoNamesDir        string
	PhotoPlaceMaxDistanceKM      float64
	PhotoFaceAnalyzerSocket      string
	PhotoFaceAnalyzerToken       string
	PhotoFacePreviewBaseURL      string
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
		SourceRunFailureRetention:    180 * 24 * time.Hour,
		PhotoPlaceGeoNamesDir:        strings.TrimSpace(os.Getenv("XD_PHOTO_PLACE_GEONAMES_DIR")),
		PhotoPlaceMaxDistanceKM:      100,
		PhotoFaceAnalyzerSocket:      strings.TrimSpace(os.Getenv("XD_PHOTO_FACE_ANALYZER_SOCKET")),
		PhotoFaceAnalyzerToken:       strings.TrimSpace(os.Getenv("XD_PHOTO_FACE_ANALYZER_TOKEN")),
		PhotoFacePreviewBaseURL:      strings.TrimSpace(os.Getenv("XD_PHOTO_FACE_PREVIEW_BASE_URL")),
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
	if v := strings.TrimSpace(os.Getenv("XD_SOURCE_RUN_FAILURE_RETENTION_DAYS")); v != "" {
		days, err := strconv.Atoi(v)
		if err != nil || days < 0 || days > 3650 {
			return Config{}, fmt.Errorf("invalid XD_SOURCE_RUN_FAILURE_RETENTION_DAYS %q", v)
		}
		cfg.SourceRunFailureRetention = time.Duration(days) * 24 * time.Hour
	}
	if v := strings.TrimSpace(os.Getenv("XD_PHOTO_PLACE_MAX_DISTANCE_KM")); v != "" {
		distance, err := strconv.ParseFloat(v, 64)
		if err != nil || distance <= 0 || distance > 500 {
			return Config{}, fmt.Errorf("invalid XD_PHOTO_PLACE_MAX_DISTANCE_KM %q; expected >0 and <=500", v)
		}
		cfg.PhotoPlaceMaxDistanceKM = distance
	}
	if cfg.PhotoFacePreviewBaseURL != "" {
		baseURL, err := normalizeInternalHTTPBaseURL(cfg.PhotoFacePreviewBaseURL)
		if err != nil {
			return Config{}, fmt.Errorf("invalid XD_PHOTO_FACE_PREVIEW_BASE_URL: %w", err)
		}
		cfg.PhotoFacePreviewBaseURL = baseURL
	}
	if cfg.PhotoFaceAnalyzerSocket != "" && cfg.PhotoFacePreviewBaseURL == "" {
		return Config{}, fmt.Errorf(
			"XD_PHOTO_FACE_PREVIEW_BASE_URL is required when XD_PHOTO_FACE_ANALYZER_SOCKET is set",
		)
	}
	return cfg, nil
}

func normalizeInternalHTTPBaseURL(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Host == "" ||
		parsed.User != nil ||
		parsed.RawQuery != "" ||
		parsed.Fragment != "" {
		return "", fmt.Errorf("expected an absolute http(s) URL without credentials, query, or fragment")
	}
	path := strings.TrimRight(parsed.EscapedPath(), "/")
	if path != "" {
		return "", fmt.Errorf("URL path must be empty")
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
