package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// This deliberately does NOT reuse the Server Static Map AK (baidu-map).
// JSAPI 4.0 requires a browser-type AK. The config stores only desired
// state: there is no JSAPI loader/session/proxy endpoint in this phase.
const (
	baiduJSAPISecretName         = "baidu-jsapi-v4"
	baiduJSAPISecretKind         = "admin-service-baidu-jsapi-v4"
	baiduJSAPISecretAADID uint64 = 2
)

var (
	errBaiduJSAPIConflict = errors.New("baidu JSAPI configuration revision changed")
	errBaiduJSAPINeedsAK  = errors.New("JSAPI browser AK required when desired enabled")
)

type baiduJSAPIDesiredConfig struct {
	DesiredEnabled bool
	Configured     bool
	Revision       uint64
	UpdatedAt      *time.Time
}

type adminBaiduJSAPIConfigDTO struct {
	Provider        string     `json:"provider"`
	DesiredEnabled  bool       `json:"desired_enabled"`
	Configured      bool       `json:"configured"`
	Editable        bool       `json:"editable"`
	Revision        uint64     `json:"revision"`
	UpdatedAt       *time.Time `json:"updated_at,omitempty"`
	RuntimeEnabled  bool       `json:"runtime_enabled"`
	ActivationState string     `json:"activation_state"`
	RequiresRestart bool       `json:"requires_restart"`
}

type baiduJSAPIConfigInput struct {
	Enabled  *bool   `json:"desired_enabled"`
	AK       string  `json:"browser_ak,omitempty"`
	ClearAK  bool    `json:"clear_ak,omitempty"`
	Revision *uint64 `json:"revision"`
}

func (s *Server) baiduJSAPIDesired(ctx context.Context) (baiduJSAPIDesiredConfig, error) {
	if s == nil || s.DB == nil {
		return baiduJSAPIDesiredConfig{}, nil
	}
	var row meta.AdminServiceSecret
	err := s.DB.WithContext(ctx).Where("name = ?", baiduJSAPISecretName).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return baiduJSAPIDesiredConfig{}, nil
	}
	if err != nil {
		return baiduJSAPIDesiredConfig{}, err
	}
	return baiduJSAPIDesiredConfig{
		DesiredEnabled: row.Enabled,
		Configured:     len(row.Ciphertext) != 0,
		Revision:       row.Revision,
		UpdatedAt:      &row.UpdatedAt,
	}, nil
}

// Status deliberately reveals neither the Browser AK nor other users' GPS.
// The runtime is not enabled merely because an administrator saved intent.
func (s *Server) mediaBaiduJSAPIStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	approved := false
	if _, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context()); err == nil {
		approved = true
	}
	state := "blocked_pending_licence_and_proxy"
	if approved {
		state = "authorized_signed_release"
	}
	c.JSON(http.StatusOK, gin.H{
		"provider":         "baidu-jsapi-4.0",
		"enabled":          approved,
		"activation_state": state,
		"attribution":      "© 百度地图",
	})
}

func (s *Server) adminBaiduJSAPIConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	cfg, err := s.baiduJSAPIDesired(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "JSAPI configuration is unavailable")
		return
	}
	approved := false
	if _, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context()); err == nil {
		approved = true
	}
	state := "blocked_pending_licence_and_proxy"
	if approved {
		state = "authorized_signed_release"
	}
	c.JSON(http.StatusOK, adminBaiduJSAPIConfigDTO{
		Provider:        "baidu-jsapi-4.0",
		DesiredEnabled:  cfg.DesiredEnabled,
		Configured:      cfg.Configured,
		Editable:        s != nil && s.DB != nil && s.ConnectorSecrets != nil,
		Revision:        cfg.Revision,
		UpdatedAt:       cfg.UpdatedAt,
		RuntimeEnabled:  approved,
		ActivationState: state,
		RequiresRestart: false,
	})
}

// A3b1: Browser AK encryption and revision-fenced administrator intent ONLY.
// No actual dynamic proxy or map fetch can be activated by this endpoint.
// A3b2/3 must independently establish licence, same-origin session,
// allowlisted resources, Safari/Android/Electron and leak-free network evidence.
func (s *Server) adminSaveBaiduJSAPIConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	if s == nil || s.DB == nil || s.ConnectorSecrets == nil {
		fail(c, http.StatusServiceUnavailable, "server-side credential encryption is not configured")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var input baiduJSAPIConfigInput
	if c.ShouldBindJSON(&input) != nil || input.Enabled == nil || input.Revision == nil {
		fail(c, http.StatusBadRequest, "desired_enabled and revision are required")
		return
	}
	ak := strings.TrimSpace(input.AK)
	if (ak != "" && !validBaiduMapAK(ak)) || (ak != "" && input.ClearAK) ||
		(input.ClearAK && *input.Enabled) {
		fail(c, http.StatusBadRequest, "invalid browser AK or incompatible clear operation")
		return
	}

	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var row meta.AdminServiceSecret
		readErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", baiduJSAPISecretName).Take(&row).Error
		exists := readErr == nil
		if readErr != nil && !errors.Is(readErr, gorm.ErrRecordNotFound) {
			return readErr
		}
		if exists && row.Revision != *input.Revision ||
			!exists && *input.Revision != 0 {
			return errBaiduJSAPIConflict
		}

		ciphertext, keyVersion := row.Ciphertext, row.KeyVersion
		if input.ClearAK {
			ciphertext, keyVersion = nil, 0
		} else if ak != "" {
			plaintext := []byte(ak)
			var sealErr error
			keyVersion, ciphertext, sealErr = s.ConnectorSecrets.Seal(
				baiduJSAPISecretAADID, baiduJSAPISecretKind, plaintext,
			)
			clear(plaintext)
			if sealErr != nil {
				return sealErr
			}
		}
		if *input.Enabled && len(ciphertext) == 0 {
			return errBaiduJSAPINeedsAK
		}
		nextRevision := uint64(1)
		if exists {
			nextRevision = row.Revision + 1
			result := tx.Model(&meta.AdminServiceSecret{}).
				Where("name = ? AND revision = ?", baiduJSAPISecretName, row.Revision).
				Updates(map[string]any{
					"enabled":     *input.Enabled,
					"ciphertext":  ciphertext,
					"key_version": keyVersion,
					"revision":    nextRevision,
					"updated_at":  time.Now().UTC(),
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errBaiduJSAPIConflict
			}
		} else {
			row = meta.AdminServiceSecret{
				Name: baiduJSAPISecretName, Enabled: *input.Enabled,
				Ciphertext: ciphertext, KeyVersion: keyVersion, Revision: nextRevision,
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}
		action := "update"
		if input.ClearAK {
			action = "clear"
		} else if ak != "" {
			action = "rotate"
		} else if !*input.Enabled {
			action = "disable"
		}
		return recordAuditTx(tx, auditEventFromContext(c,
			"admin.service.baidu_jsapi.configure", "service", baiduJSAPISecretName,
			"Baidu JSAPI 4.0 Browser AK (desired only)", auditpkg.ResultSuccess,
			map[string]any{
				"operation": action, "desired_enabled": *input.Enabled,
				"revision": nextRevision, "runtime_enabled": false,
			},
		))
	})
	if err != nil {
		switch {
		case errors.Is(err, errBaiduJSAPIConflict):
			fail(c, http.StatusConflict, "JSAPI settings changed; refresh and retry")
		case errors.Is(err, errBaiduJSAPINeedsAK):
			fail(c, http.StatusBadRequest, "Browser AK required for desired enablement")
		default:
			fail(c, http.StatusInternalServerError, "save JSAPI configuration failed")
		}
		return
	}
	s.adminBaiduJSAPIConfig(c)
}
