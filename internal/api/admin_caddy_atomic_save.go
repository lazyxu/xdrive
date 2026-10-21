package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// This is a desired-only database transaction. It intentionally has no
// Host, Docker, DNS, ACME, CA, restart, or Applied Receipt capability.
// The v1.1 UI must separately ask for a gated Host deployment after saving.
type atomicCaddyHTTPSInput struct {
	Enabled    *bool   `json:"enabled"`
	Domain     *string `json:"domain"`
	LANEnabled *bool   `json:"lan_enabled"`
	LANIP      *string `json:"lan_ip"`
}

type atomicCaddyAliDNSInput struct {
	Action          string `json:"action"`
	AccessKeyID     string `json:"access_key_id,omitempty"`
	AccessKeySecret string `json:"access_key_secret,omitempty"`
}

type atomicCaddySaveInput struct {
	HTTPSRevision  *uint64                 `json:"https_revision"`
	AliDNSRevision *uint64                 `json:"alidns_revision"`
	HTTPS          *atomicCaddyHTTPSInput  `json:"https,omitempty"`
	AliDNS         *atomicCaddyAliDNSInput `json:"alidns,omitempty"`
}

// adminSaveCaddyConfiguration atomically saves any modified HTTPS and AliDNS
// groups. Each expected revision is ALWAYS supplied and checked, including
// when only one group is being updated. No partial DB success is possible.
func (s *Server) adminSaveCaddyConfiguration(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "Caddy database unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	var input atomicCaddySaveInput
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var extra any
	if decoder.Decode(&input) != nil || decoder.Decode(&extra) != io.EOF ||
		input.HTTPSRevision == nil || input.AliDNSRevision == nil ||
		*input.HTTPSRevision > 1<<60 || *input.AliDNSRevision > 1<<60 ||
		(input.HTTPS == nil && input.AliDNS == nil) {
		fail(c, http.StatusBadRequest, "full current Caddy HTTPS and AliDNS revisions required")
		return
	}

	domain := ""
	if input.HTTPS != nil {
		cfg := input.HTTPS
		if cfg.Enabled == nil || cfg.Domain == nil || cfg.LANEnabled == nil || cfg.LANIP == nil {
			fail(c, http.StatusBadRequest, "both HTTPS ingress targets required")
			return
		}
		domain = strings.ToLower(*cfg.Domain)
		if !validCaddyIngressSelection(*cfg.Enabled, domain, *cfg.LANEnabled, *cfg.LANIP) {
			fail(c, http.StatusBadRequest, "invalid Caddy HTTPS domain or LAN ingress selection")
			return
		}
	}

	action := "keep"
	var ciphertext []byte
	var keyVersion uint32
	if input.AliDNS != nil {
		action = input.AliDNS.Action
		switch action {
		case "replace":
			pair := caddyAliDNSSecretPair{
				AccessKeyID:     input.AliDNS.AccessKeyID,
				AccessKeySecret: input.AliDNS.AccessKeySecret,
			}
			if !validCaddyAliDNSPair(pair) {
				fail(c, http.StatusBadRequest, "valid AliDNS ID and Secret must both be supplied")
				return
			}
			if s.ConnectorSecrets == nil {
				fail(c, http.StatusServiceUnavailable, "Caddy credential encryption unavailable")
				return
			}
			plain, err := json.Marshal(pair)
			if err != nil {
				fail(c, http.StatusServiceUnavailable, "Caddy credential encoding unavailable")
				return
			}
			keyVersion, ciphertext, err = s.ConnectorSecrets.Seal(
				caddyAliDNSSecretAADID, caddyAliDNSSecretKind, plain)
			clear(plain)
			if err != nil {
				fail(c, http.StatusServiceUnavailable, "Caddy credential encryption unavailable")
				return
			}
		case "clear":
			if input.AliDNS.AccessKeyID != "" || input.AliDNS.AccessKeySecret != "" ||
				s.ConnectorSecrets == nil {
				fail(c, http.StatusBadRequest, "clearing AliDNS requires explicit clear without credentials")
				return
			}
		default:
			fail(c, http.StatusBadRequest, "unsupported AliDNS operation")
			return
		}
	}
	// Match Host reservation lock order: HTTPS row -> credential row -> pending.
	// The local mutexes also serialize the legacy per-group handlers in-process;
	// row locks and CAS are authoritative between independent Server replicas.
	s.caddyHTTPSSaveMu.Lock()
	defer s.caddyHTTPSSaveMu.Unlock()
	s.caddyAliDNSSaveMu.Lock()
	defer s.caddyAliDNSSaveMu.Unlock()

	nextHTTPS, nextAliDNS := *input.HTTPSRevision, *input.AliDNSRevision
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var desired meta.AdminCaddyHTTPSSetting
		q := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", caddyHTTPSSettingName).Take(&desired).Error
		haveHTTPS := q == nil
		if q != nil && !errors.Is(q, gorm.ErrRecordNotFound) {
			return q
		}
		if (haveHTTPS && desired.Revision != *input.HTTPSRevision) ||
			(!haveHTTPS && *input.HTTPSRevision != 0) {
			return errCaddyHTTPSRevision
		}
		if haveHTTPS && (desired.Revision == 0 ||
			!validCaddyIngressSelection(desired.Enabled, desired.Domain,
				desired.LANEnabled, desired.LANIP)) {
			return errors.New("invalid stored HTTPS desired state")
		}

		var credential meta.AdminServiceSecret
		q = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", caddyAliDNSSecretName).Take(&credential).Error
		haveAliDNS := q == nil
		if q != nil && !errors.Is(q, gorm.ErrRecordNotFound) {
			return q
		}
		if (haveAliDNS && credential.Revision != *input.AliDNSRevision) ||
			(!haveAliDNS && *input.AliDNSRevision != 0) {
			return errCaddyAliDNSConflict
		}
		if haveAliDNS && (credential.Revision == 0 ||
			(len(credential.Ciphertext) > 0 && (credential.KeyVersion == 0 || !credential.Enabled)) ||
			(len(credential.Ciphertext) == 0 && (credential.Enabled || credential.KeyVersion != 0))) {
			return errors.New("invalid stored Caddy credential state")
		}
		if err := rejectCaddyHostPendingMutationTx(tx); err != nil {
			return err
		}
		if input.AliDNS != nil && action == "clear" &&
			(!haveAliDNS || len(credential.Ciphertext) == 0) {
			return errCaddyAliDNSNotConfigured
		}

		if input.HTTPS != nil {
			oldEnabled, oldDomain, oldLANEnabled, oldLANIP, origin :=
				false, "", false, "", "default"
			if haveHTTPS {
				oldEnabled, oldDomain = desired.Enabled, desired.Domain
				oldLANEnabled, oldLANIP = desired.LANEnabled, desired.LANIP
				origin = "saved"
				if desired.Origin == caddyImportedHostOrigin {
					origin = caddyImportedHostOrigin
				}
			}
			if err := recordCaddyHTTPSRevisionTx(tx, *input.HTTPSRevision,
				oldEnabled, oldDomain, oldLANEnabled, oldLANIP, origin); err != nil {
				return err
			}
			nextHTTPS = *input.HTTPSRevision + 1
			if haveHTTPS {
				r := tx.Model(&meta.AdminCaddyHTTPSSetting{}).
					Where("name = ? AND revision = ?", caddyHTTPSSettingName, desired.Revision).
					Updates(map[string]any{
						"enabled": *input.HTTPS.Enabled, "domain": domain,
						"lan_enabled": *input.HTTPS.LANEnabled, "lan_ip": *input.HTTPS.LANIP,
						"revision": nextHTTPS, "origin": "saved", "updated_at": time.Now().UTC(),
					})
				if r.Error != nil {
					return r.Error
				}
				if r.RowsAffected != 1 {
					return errCaddyHTTPSRevision
				}
			} else {
				r := tx.Clauses(clause.OnConflict{DoNothing: true}).
					Create(&meta.AdminCaddyHTTPSSetting{
						Name: caddyHTTPSSettingName, Revision: nextHTTPS,
						Enabled: *input.HTTPS.Enabled, Domain: domain,
						LANEnabled: *input.HTTPS.LANEnabled, LANIP: *input.HTTPS.LANIP,
						Origin: "saved",
					})
				if r.Error != nil {
					return r.Error
				}
				if r.RowsAffected != 1 {
					return errCaddyHTTPSRevision
				}
			}
			if err := recordCaddyHTTPSRevisionTx(tx, nextHTTPS,
				*input.HTTPS.Enabled, domain, *input.HTTPS.LANEnabled, *input.HTTPS.LANIP,
				"saved"); err != nil {
				return err
			}
		}

		if input.AliDNS != nil {
			nextAliDNS = *input.AliDNSRevision + 1
			if haveAliDNS {
				r := tx.Model(&meta.AdminServiceSecret{}).
					Where("name = ? AND revision = ?", caddyAliDNSSecretName, credential.Revision).
					Updates(map[string]any{
						"enabled": action == "replace", "ciphertext": ciphertext,
						"key_version": keyVersion, "revision": nextAliDNS,
						"origin": "saved", "updated_at": time.Now().UTC(),
					})
				if r.Error != nil {
					return r.Error
				}
				if r.RowsAffected != 1 {
					return errCaddyAliDNSConflict
				}
			} else {
				r := tx.Clauses(clause.OnConflict{DoNothing: true}).
					Create(&meta.AdminServiceSecret{
						Name: caddyAliDNSSecretName, Enabled: true, Ciphertext: ciphertext,
						KeyVersion: keyVersion, Revision: nextAliDNS, Origin: "saved",
					})
				if r.Error != nil {
					return r.Error
				}
				if r.RowsAffected != 1 {
					return errCaddyAliDNSConflict
				}
			}
		}
		return recordAuditTx(tx, auditEventFromContext(c,
			"admin.service.caddy.configuration.save", "service", "caddy",
			"Caddy HTTPS and AliDNS desired transaction", auditpkg.ResultSuccess,
			map[string]any{
				"https_revision": nextHTTPS, "alidns_revision": nextAliDNS,
				"https_changed": input.HTTPS != nil, "alidns_action": action,
				"host_applied": false,
			},
		))
	})
	switch {
	case errors.Is(err, errCaddyHTTPSRevision), errors.Is(err, errCaddyAliDNSConflict):
		fail(c, http.StatusConflict, "Caddy desired revisions changed; refresh both groups")
	case errors.Is(err, errCaddyHostDBReservationBlocked):
		fail(c, http.StatusConflict, "Unapplied Host reservation blocks Caddy configuration edits")
	case errors.Is(err, errCaddyAliDNSNotConfigured):
		fail(c, http.StatusConflict, "No staged AliDNS credentials to clear")
	case err != nil:
		fail(c, http.StatusServiceUnavailable, "Caddy configuration not persisted or audited")
	default:
		c.JSON(http.StatusOK, gin.H{
			"https_revision":  nextHTTPS,
			"alidns_revision": nextAliDNS,
			"saved":           true, "host_applied": false, "apply_supported": false,
		})
	}
}
