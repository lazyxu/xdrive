package api

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const caddyImportedHostOrigin = "host-import"

// CaddyHostDeploymentImport is supplied ONLY by the locally installed trusted
// host CLI over bounded stdin; never by HTTP, the Agent, or the browser.
// It describes deployment settings, NOT their externally proven effectiveness.
type CaddyHostDeploymentImport struct {
	Domain             string
	LANIP              string
	AliDNSAccessKeyID  string
	AliDNSAccessSecret string
}

// ImportCaddyHostDeployment atomically adopts the legacy host's existing
// domain/LAN desired identity and, when needed, encrypts its paired AliDNS
// credentials into the same admin tables used by the System Dependencies UI.
// Existing administrator revisions and credentials are NEVER overwritten.
// This function is not a gateway restart or a signed applied-revision receipt.
func ImportCaddyHostDeployment(ctx context.Context, db *gorm.DB,
	keyring *connectorsecret.Keyring, input CaddyHostDeploymentImport) (string, error) {
	if ctx == nil || db == nil {
		return "", errors.New("Caddy adoption database unavailable")
	}
	domain := strings.ToLower(input.Domain)
	enabled := domain != ""
	lanEnabled := input.LANIP != ""
	if !validCaddyIngressSelection(enabled, domain, lanEnabled, input.LANIP) ||
		input.Domain != strings.TrimSpace(input.Domain) {
		return "", errors.New("invalid existing Caddy host HTTPS entries")
	}
	// Only validate/seal the host's provider credentials when FIRST importing
	// an unmanaged record. A repeated upgrade must not require unavailable
	// host secrets or a rotated keyring after an administrator took ownership.
	if !enabled && (input.AliDNSAccessKeyID != "" || input.AliDNSAccessSecret != "") {
		return "", errors.New("Caddy DNS-01 credentials exist without an enabled domain")
	}
	result := "already-managed"
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var desired meta.AdminCaddyHTTPSSetting
		readErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", caddyHTTPSSettingName).Take(&desired).Error
		if readErr == nil {
			// An administrator may have edited since deployment. Its persisted
			// intent takes precedence, even if it disagrees with the host.
			return nil
		}
		if !errors.Is(readErr, gorm.ErrRecordNotFound) {
			return readErr
		}
		if err := rejectCaddyHostPendingMutationTx(tx); err != nil {
			return err
		}
		var existing meta.AdminServiceSecret
		credentialErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", caddyAliDNSSecretName).Take(&existing).Error
		credentialExists := credentialErr == nil
		if credentialErr != nil && !errors.Is(credentialErr, gorm.ErrRecordNotFound) {
			return credentialErr
		}
		var ciphertext []byte
		var keyVersion uint32
		if enabled && !credentialExists {
			if keyring == nil || !validCaddyAliDNSPair(caddyAliDNSSecretPair{
				AccessKeyID:     input.AliDNSAccessKeyID,
				AccessKeySecret: input.AliDNSAccessSecret,
			}) {
				return errors.New("existing Caddy DNS-01 credentials cannot be adopted")
			}
			plaintext, marshalErr := json.Marshal(caddyAliDNSSecretPair{
				AccessKeyID:     input.AliDNSAccessKeyID,
				AccessKeySecret: input.AliDNSAccessSecret,
			})
			if marshalErr != nil {
				return errors.New("cannot encode private Caddy DNS-01 credentials")
			}
			var sealErr error
			keyVersion, ciphertext, sealErr = keyring.Seal(
				caddyAliDNSSecretAADID, caddyAliDNSSecretKind, plaintext,
			)
			clear(plaintext)
			if sealErr != nil {
				return errors.New("cannot encrypt private Caddy DNS-01 credentials")
			}
			defer clear(ciphertext)
		}
		created := tx.Clauses(clause.OnConflict{DoNothing: true}).
			Create(&meta.AdminCaddyHTTPSSetting{
				Name: caddyHTTPSSettingName, Revision: 1,
				Enabled: enabled, Domain: domain,
				LANEnabled: lanEnabled, LANIP: input.LANIP,
				Origin: caddyImportedHostOrigin,
			})
		if created.Error != nil {
			return created.Error
		}
		if created.RowsAffected != 1 {
			return nil
		}
		if err := recordCaddyHTTPSRevisionTx(tx, 1, enabled, domain,
			lanEnabled, input.LANIP, caddyImportedHostOrigin); err != nil {
			return err
		}
		credentialImported := false
		if enabled && !credentialExists {
			createSecret := tx.Clauses(clause.OnConflict{DoNothing: true}).
				Create(&meta.AdminServiceSecret{
					Name: caddyAliDNSSecretName, Enabled: true, Revision: 1,
					KeyVersion: keyVersion, Ciphertext: ciphertext,
					Origin: caddyImportedHostOrigin,
				})
			if createSecret.Error != nil {
				return createSecret.Error
			}
			if createSecret.RowsAffected != 1 {
				// Another host/admin credential rotation must never be
				// silently overwritten or presented as imported.
				return errors.New("Caddy credential changed during host adoption")
			}
			credentialImported = true
		}
		if err := auditpkg.Record(tx, auditpkg.Event{
			ActorUsername: "host", ActorRole: "system",
			Action: "system.caddy.host_adopt", TargetType: "service",
			TargetID: "caddy", TargetLabel: "Caddy deployment import",
			Result: auditpkg.ResultSuccess,
			Metadata: map[string]any{
				"desired_revision": 1, "domain_enabled": enabled,
				"lan_enabled": lanEnabled, "credentials_imported": credentialImported,
				"host_applied": false, "source": caddyImportedHostOrigin,
			},
		}); err != nil {
			return err
		}
		result = "imported-unverified"
		return nil
	})
	if err != nil {
		// Never include row contents or provider credentials in caller logs.
		return "", errors.New("Caddy host adoption transaction was not committed")
	}
	return result, nil
}
