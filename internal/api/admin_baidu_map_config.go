package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	baiduMapSecretName = "baidu-map"
	// The connector keyring's AEAD includes both a stable synthetic identifier
	// and this unique kind as associated data. No source credential uses it.
	baiduMapSecretKind         = "admin-service-baidu-map"
	baiduMapSecretAADID uint64 = 1
	maxBaiduMapAKBytes         = 256
)

var (
	errBaiduMapConfigConflict  = errors.New("baidu map configuration changed")
	errBaiduMapConfigMissingAK = errors.New("baidu map AK is required when enabled")
)

type baiduMapEffectiveConfig struct {
	Enabled    bool
	Configured bool
	AK         string
	Source     string
	Revision   uint64
	UpdatedAt  *time.Time
}

type adminBaiduMapConfigDTO struct {
	Enabled         bool       `json:"enabled"`
	Configured      bool       `json:"configured"`
	Source          string     `json:"source"`
	Editable        bool       `json:"editable"`
	RequiresRestart bool       `json:"requires_restart"`
	Revision        uint64     `json:"revision"`
	UpdatedAt       *time.Time `json:"updated_at,omitempty"`
}

type adminBaiduMapConfigInput struct {
	Enabled  *bool   `json:"enabled"`
	AK       string  `json:"ak,omitempty"`
	ClearAK  bool    `json:"clear_ak,omitempty"`
	Revision *uint64 `json:"revision"`
}

func (s *Server) baiduMapDeploymentConfig() baiduMapEffectiveConfig {
	ak := strings.TrimSpace(s.BaiduMapAK)
	return baiduMapEffectiveConfig{
		Enabled:    s.BaiduMapEnabled,
		Configured: ak != "",
		AK:         ak,
		Source:     "environment",
	}
}

// The database is the live source of truth after an administrator saves config.
// Read it on each request: no process/container restart, stale in-memory secret,
// or cross-replica cache invalidation is necessary.
func (s *Server) effectiveBaiduMapConfig(ctx context.Context) (baiduMapEffectiveConfig, error) {
	if s.DB == nil {
		return s.baiduMapDeploymentConfig(), nil
	}
	var row meta.AdminServiceSecret
	err := s.DB.WithContext(ctx).Where("name = ?", baiduMapSecretName).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return s.baiduMapDeploymentConfig(), nil
	}
	if err != nil {
		return baiduMapEffectiveConfig{}, err
	}
	cfg := baiduMapEffectiveConfig{
		Enabled:    row.Enabled,
		Configured: len(row.Ciphertext) > 0,
		Source:     "saved",
		Revision:   row.Revision,
		UpdatedAt:  &row.UpdatedAt,
	}
	if cfg.Configured {
		if s.ConnectorSecrets == nil {
			return baiduMapEffectiveConfig{}, fmt.Errorf("encrypted Baidu map AK cannot be opened without the keyring")
		}
		plaintext, err := s.ConnectorSecrets.Open(baiduMapSecretAADID, baiduMapSecretKind, row.KeyVersion, row.Ciphertext)
		if err != nil {
			return baiduMapEffectiveConfig{}, err
		}
		cfg.AK = string(plaintext)
		clear(plaintext)
		if cfg.AK == "" {
			return baiduMapEffectiveConfig{}, fmt.Errorf("decrypted Baidu map AK is empty")
		}
	}
	return cfg, nil
}

func validBaiduMapAK(value string) bool {
	if value == "" || len(value) > maxBaiduMapAKBytes {
		return false
	}
	for _, char := range value {
		if char < '!' || char > '~' {
			return false
		}
	}
	return true
}

func (s *Server) adminBaiduMapConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	cfg, err := s.effectiveBaiduMapConfig(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "baidu map configuration is unavailable")
		return
	}
	c.JSON(http.StatusOK, adminBaiduMapConfigDTO{
		Enabled:         cfg.Enabled,
		Configured:      cfg.Configured,
		Source:          cfg.Source,
		Editable:        s.DB != nil && s.ConnectorSecrets != nil,
		RequiresRestart: false,
		Revision:        cfg.Revision,
		UpdatedAt:       cfg.UpdatedAt,
	})
}

// adminRevealBaiduMapAK mirrors the explicit, temporary Yike Cookie reveal.
// Only the existing admin middleware may route here. No secret is included in
// a normal health or config response, and an audit record is required before
// the plaintext may leave the Server.
func (s *Server) adminRevealBaiduMapAK(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	if s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "baidu map configuration is unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256)
	var req struct {
		Revision *uint64 `json:"revision"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Revision == nil {
		fail(c, http.StatusBadRequest, "configuration revision is required")
		return
	}
	cfg, err := s.effectiveBaiduMapConfig(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "baidu map configuration is unavailable")
		return
	}
	if cfg.Revision != *req.Revision {
		fail(c, http.StatusConflict, "baidu map settings changed; refresh and retry")
		return
	}
	if !cfg.Configured || cfg.AK == "" {
		fail(c, http.StatusConflict, "baidu map AK is not configured")
		return
	}
	// A privileged reveal must never be unaudited. Audit metadata excludes
	// the AK and any plaintext-bearing URL.
	if err := recordAuditTx(s.DB.WithContext(c.Request.Context()), auditEventFromContext(
		c, "admin.service.baidu_map.reveal", "service", baiduMapSecretName,
		"百度地图 Server API", auditpkg.ResultSuccess,
		map[string]any{"field": "ak", "source": cfg.Source, "revision": cfg.Revision},
	)); err != nil {
		fail(c, http.StatusServiceUnavailable, "credential reveal audit is unavailable")
		return
	}
	c.JSON(http.StatusOK, sourceCredentialRevealDTO{
		Field: "ak", Value: cfg.AK, ExpiresInSeconds: sourceCredentialRevealSeconds,
	})
}

func (s *Server) adminSaveBaiduMapConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	if s.DB == nil || s.ConnectorSecrets == nil {
		fail(c, http.StatusServiceUnavailable, "server-side credential encryption is not configured")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var input adminBaiduMapConfigInput
	if err := c.ShouldBindJSON(&input); err != nil ||
		input.Enabled == nil || input.Revision == nil {
		fail(c, http.StatusBadRequest, "enabled and revision are required")
		return
	}
	ak := strings.TrimSpace(input.AK)
	if (ak != "" && !validBaiduMapAK(ak)) || (input.ClearAK && ak != "") {
		fail(c, http.StatusBadRequest, "invalid Baidu map AK or conflicting clear flag")
		return
	}
	ctx := c.Request.Context()
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row meta.AdminServiceSecret
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", baiduMapSecretName).Take(&row).Error
		exists := err == nil
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if exists && row.Revision != *input.Revision ||
			!exists && *input.Revision != 0 {
			return errBaiduMapConfigConflict
		}

		ciphertext := row.Ciphertext
		keyVersion := row.KeyVersion
		// Initial saved settings inherit a deployment AK only when the UI
		// leaves the AK field blank. A saved row always overrides deployment.
		if !exists && ak == "" && !input.ClearAK {
			ak = strings.TrimSpace(s.BaiduMapAK)
		}
		if input.ClearAK {
			ciphertext = nil
			keyVersion = 0
		} else if ak != "" {
			var err error
			keyVersion, ciphertext, err = s.ConnectorSecrets.Seal(
				baiduMapSecretAADID, baiduMapSecretKind, []byte(ak),
			)
			if err != nil {
				return err
			}
		}
		if *input.Enabled && len(ciphertext) == 0 {
			return errBaiduMapConfigMissingAK
		}
		nextRevision := uint64(1)
		if exists {
			nextRevision = row.Revision + 1
			update := tx.Model(&meta.AdminServiceSecret{}).
				Where("name = ? AND revision = ?", baiduMapSecretName, row.Revision).
				Updates(map[string]any{
					"enabled": *input.Enabled, "ciphertext": ciphertext,
					"key_version": keyVersion, "revision": nextRevision,
					"updated_at": time.Now().UTC(),
				})
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected != 1 {
				return errBaiduMapConfigConflict
			}
		} else {
			row = meta.AdminServiceSecret{
				Name: baiduMapSecretName, Enabled: *input.Enabled,
				Ciphertext: ciphertext, KeyVersion: keyVersion, Revision: 1,
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}
		action := "update"
		if input.ClearAK {
			action = "clear"
		} else if input.AK != "" {
			action = "rotate"
		} else if !*input.Enabled {
			action = "disable"
		}
		return recordAuditTx(tx, auditEventFromContext(
			c, "admin.service.baidu_map.configure", "service", baiduMapSecretName,
			"百度地图 Server API", auditpkg.ResultSuccess,
			map[string]any{
				"operation": action, "enabled": *input.Enabled,
				"revision": nextRevision,
			},
		))
	})
	if err != nil {
		switch {
		case errors.Is(err, errBaiduMapConfigConflict):
			fail(c, http.StatusConflict, "baidu map settings changed; refresh and retry")
		case errors.Is(err, errBaiduMapConfigMissingAK):
			fail(c, http.StatusBadRequest, "Baidu map AK is required when enabled")
		default:
			fail(c, http.StatusInternalServerError, "save Baidu map configuration failed")
		}
		return
	}
	// All Server replicas read this encrypted record on their next request.
	s.adminBaiduMapConfig(c)
}
