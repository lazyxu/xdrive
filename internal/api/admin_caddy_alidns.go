package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CD3b1 stages only global AliDNS DNS-01 credentials. There is intentionally
// no path from these handlers to Caddy, Docker, Host Manager, or DNS.
const (
	caddyAliDNSSecretName         = "caddy-alidns"
	caddyAliDNSSecretKind         = "admin-service-caddy-alidns"
	caddyAliDNSSecretAADID uint64 = 2
)
const caddyAliDNSPendingRequirement = "存在待协调的 Host 配置申请；AliDNS 凭据修改与清除已被锁定。需由独立操作员核对或恢复，不代表 DNS/HTTPS 已生效。"
const caddyAliDNSRequirement = "AliDNS 凭据仅加密保存为全局管理员期望值，尚未交付宿主机，也未进行真实 DNS/ACME 验证。实际使用需后续受限 Host Manager 预检、防失联、审计应用和核验；当前不会修改 Caddy 或影响传输。"

var errCaddyAliDNSConflict = errors.New("Caddy AliDNS configuration revision changed")
var errCaddyAliDNSNotConfigured = errors.New("Caddy AliDNS credentials are not configured")

type caddyAliDNSSecretPair struct {
	AccessKeyID     string `json:"access_key_id"`
	AccessKeySecret string `json:"access_key_secret"`
}

// These credentials are not used by this Server for any external request.
// Reject control characters/whitespace and unreasonably long input.
func validCaddyAliDNSCredential(value string, minLength, maxLength int) bool {
	if len(value) < minLength || len(value) > maxLength {
		return false
	}
	for i := 0; i < len(value); i++ {
		if value[i] < '!' || value[i] > '~' {
			return false
		}
	}
	return true
}

func validCaddyAliDNSPair(pair caddyAliDNSSecretPair) bool {
	return validCaddyAliDNSCredential(pair.AccessKeyID, 8, 128) &&
		validCaddyAliDNSCredential(pair.AccessKeySecret, 8, 256)
}

type adminCaddyAliDNSConfigDTO struct {
	Configured     bool       `json:"configured"`
	Revision       uint64     `json:"revision"`
	Source         string     `json:"source"`
	UpdatedAt      *time.Time `json:"updated_at,omitempty"`
	Editable       bool       `json:"editable"`
	ApplyState     string     `json:"apply_state"`
	ApplySupported bool       `json:"apply_supported"`
	Requirement    string     `json:"requirement"`

	HostApplyPending bool `json:"host_apply_pending"`
}

func (s *Server) readCaddyAliDNSSetting(c *gin.Context) (meta.AdminServiceSecret, bool, error) {
	if s == nil || s.DB == nil {
		return meta.AdminServiceSecret{}, false, errors.New("Caddy AliDNS settings database unavailable")
	}
	return readCaddyAliDNSSettingDB(s.DB.WithContext(c.Request.Context()))
}

func readCaddyAliDNSSettingDB(db *gorm.DB) (meta.AdminServiceSecret, bool, error) {
	var row meta.AdminServiceSecret
	err := db.Where("name = ?", caddyAliDNSSecretName).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return row, false, nil
	}
	if err != nil {
		return row, false, err
	}
	if row.Revision == 0 || (len(row.Ciphertext) > 0 && row.KeyVersion == 0) ||
		(len(row.Ciphertext) == 0 && (row.Enabled || row.KeyVersion != 0)) ||
		(len(row.Ciphertext) > 0 && !row.Enabled) {
		return meta.AdminServiceSecret{}, false, errors.New("invalid Caddy AliDNS credential state")
	}
	return row, true, nil
}

func (s *Server) adminCaddyAliDNSConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	row, exists, err := s.readCaddyAliDNSSetting(c)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy AliDNS configuration unavailable")
		return
	}
	hostPending, err := readCaddyHostPendingUnappliedDB(s.DB.WithContext(c.Request.Context()))
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy host reservation state unavailable")
		return
	}
	requirement := caddyAliDNSRequirement
	if hostPending {
		requirement = caddyAliDNSPendingRequirement
	}
	state, source := "unmanaged", "unset"
	if exists {
		state, source = "pending", "saved"
		if row.Origin == caddyImportedHostOrigin {
			source = caddyImportedHostOrigin
		}
	}
	c.JSON(http.StatusOK, adminCaddyAliDNSConfigDTO{
		Configured: exists && len(row.Ciphertext) > 0,
		Revision:   row.Revision, Source: source,
		UpdatedAt: func() *time.Time {
			if exists {
				return &row.UpdatedAt
			}
			return nil
		}(),
		Editable:   s.ConnectorSecrets != nil && !hostPending,
		ApplyState: state, ApplySupported: false, HostApplyPending: hostPending,
		Requirement: requirement,
	})
}

func (s *Server) adminSaveCaddyAliDNS(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	if s == nil || s.DB == nil || s.ConnectorSecrets == nil {
		fail(c, http.StatusServiceUnavailable, "Caddy AliDNS encrypted storage unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var input struct {
		Revision        *uint64 `json:"revision"`
		AccessKeyID     string  `json:"access_key_id"`
		AccessKeySecret string  `json:"access_key_secret"`
		Clear           bool    `json:"clear"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil || *input.Revision > 1<<60 {
		fail(c, http.StatusBadRequest, "Caddy AliDNS revision required")
		return
	}
	pair := caddyAliDNSSecretPair{AccessKeyID: input.AccessKeyID, AccessKeySecret: input.AccessKeySecret}
	if (input.Clear && (pair.AccessKeyID != "" || pair.AccessKeySecret != "")) ||
		(!input.Clear && !validCaddyAliDNSPair(pair)) {
		fail(c, http.StatusBadRequest, "provide both valid AliDNS credentials, or clear without credentials")
		return
	}
	s.caddyAliDNSSaveMu.Lock()
	defer s.caddyAliDNSSaveMu.Unlock()
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Match the Host DB reservation lock order: HTTPS desired -> AliDNS
		// credential -> fixed pending row. A credential row may not exist yet;
		// the desired lock still prevents a concurrent DB reservation race.
		if err := lockCaddyDesiredBeforeAliDNSMutationTx(tx); err != nil {
			return err
		}
		var previous meta.AdminServiceSecret
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("name = ?", caddyAliDNSSecretName).Take(&previous).Error
		exists := err == nil
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if (exists && previous.Revision != *input.Revision) || (!exists && *input.Revision != 0) {
			return errCaddyAliDNSConflict
		}
		if err := rejectCaddyHostPendingMutationTx(tx); err != nil {
			return err
		}
		if input.Clear && (!exists || len(previous.Ciphertext) == 0) {
			return errCaddyAliDNSNotConfigured
		}
		var ciphertext []byte
		var keyVersion uint32
		if !input.Clear {
			plaintext, err := json.Marshal(pair)
			if err != nil {
				return err
			}
			keyVersion, ciphertext, err = s.ConnectorSecrets.Seal(caddyAliDNSSecretAADID, caddyAliDNSSecretKind, plaintext)
			clear(plaintext)
			if err != nil {
				return err
			}
		}
		next := *input.Revision + 1
		if exists {
			updated := tx.Model(&meta.AdminServiceSecret{}).
				Where("name = ? AND revision = ?", caddyAliDNSSecretName, previous.Revision).
				Updates(map[string]any{
					"enabled": !input.Clear, "ciphertext": ciphertext,
					"key_version": keyVersion, "revision": next, "origin": "saved",
					"updated_at": time.Now().UTC(),
				})
			if updated.Error != nil {
				return updated.Error
			}
			if updated.RowsAffected != 1 {
				return errCaddyAliDNSConflict
			}
		} else {
			created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&meta.AdminServiceSecret{
				Name: caddyAliDNSSecretName, Enabled: true, Ciphertext: ciphertext,
				KeyVersion: keyVersion, Revision: next,
			})
			if created.Error != nil {
				return created.Error
			}
			if created.RowsAffected != 1 {
				return errCaddyAliDNSConflict
			}
		}
		operation := "rotate"
		if input.Clear {
			operation = "clear"
		}
		return recordAuditTx(tx, auditEventFromContext(c,
			"admin.service.caddy_alidns.configure", "service", caddyAliDNSSecretName,
			"Caddy AliDNS staged credentials", auditpkg.ResultSuccess,
			map[string]any{"operation": operation, "revision": next, "configured": !input.Clear, "host_applied": false},
		))
	})
	switch {
	case errors.Is(err, errCaddyHostDBReservationBlocked):
		fail(c, http.StatusConflict, "Unapplied Caddy host reservation blocks AliDNS edits until operator reconciliation")
		return
	case errors.Is(err, errCaddyAliDNSConflict):
		fail(c, http.StatusConflict, "Caddy AliDNS credential revision changed; refresh")
		return
	case errors.Is(err, errCaddyAliDNSNotConfigured):
		fail(c, http.StatusConflict, "No staged AliDNS credentials to clear")
		return
	case err != nil:
		fail(c, http.StatusServiceUnavailable, "AliDNS credential change was not persisted or audited")
		return
	}
	s.adminCaddyAliDNSConfig(c)
}

// Reveal is an explicit administrator-only action and never part of normal
// list, health, config, audit or log responses.
func (s *Server) adminRevealCaddyAliDNS(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	if s == nil || s.DB == nil || s.ConnectorSecrets == nil {
		fail(c, http.StatusServiceUnavailable, "Caddy AliDNS credentials unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256)
	var input struct {
		Revision *uint64 `json:"revision"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil || *input.Revision > 1<<60 {
		fail(c, http.StatusBadRequest, "AliDNS credential revision required")
		return
	}
	var pair caddyAliDNSSecretPair
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var row meta.AdminServiceSecret
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", caddyAliDNSSecretName).Take(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errCaddyAliDNSConflict
		}
		if err != nil {
			return err
		}
		if row.Revision != *input.Revision {
			return errCaddyAliDNSConflict
		}
		if len(row.Ciphertext) == 0 {
			return errCaddyAliDNSNotConfigured
		}
		if row.KeyVersion == 0 || !row.Enabled {
			return errors.New("invalid encrypted AliDNS state")
		}
		plaintext, err := s.ConnectorSecrets.Open(caddyAliDNSSecretAADID, caddyAliDNSSecretKind,
			row.KeyVersion, row.Ciphertext)
		if err != nil {
			return err
		}
		err = json.Unmarshal(plaintext, &pair)
		clear(plaintext)
		if err != nil || !validCaddyAliDNSPair(pair) {
			return errors.New("invalid AliDNS credential payload")
		}
		// A revision-locked audit commits before the plaintext is returned.
		return recordAuditTx(tx, auditEventFromContext(c,
			"admin.service.caddy_alidns.reveal", "service", caddyAliDNSSecretName,
			"Caddy AliDNS credential reveal", auditpkg.ResultSuccess,
			map[string]any{"revision": row.Revision, "fields": 2},
		))
	})
	switch {
	case errors.Is(err, errCaddyAliDNSConflict):
		fail(c, http.StatusConflict, "AliDNS credentials changed; refresh")
		return
	case errors.Is(err, errCaddyAliDNSNotConfigured):
		fail(c, http.StatusConflict, "AliDNS credentials not configured")
		return
	case err != nil:
		fail(c, http.StatusServiceUnavailable, "AliDNS reveal or audit unavailable")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"access_key_id":      pair.AccessKeyID,
		"access_key_secret":  pair.AccessKeySecret,
		"expires_in_seconds": 60,
	})
}
