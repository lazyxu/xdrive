package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const caddyHostDBReservationName = "caddy-https"

var errCaddyHostDBReservationBlocked = errors.New("Caddy host DB pending reservation blocked")

// caddyHostDBReservationRequest holds only non-secret fingerprints from a
// previously verified operator request. This method DOES NOT verify a
// signature; the independently trusted operator check must happen before any
// future caller uses this private, non-routable DB-only primitive.
type caddyHostDBReservationRequest struct {
	HTTPSRevision              uint64
	CredentialRevision         uint64
	OperationSHA256            string
	NonceSHA256                string
	IntentSHA256               string
	PlanSHA256                 string
	CandidateEnvironmentSHA256 string
}

func validCaddyHostDBDigest(value string) bool {
	if len(value) != 64 {
		return false
	}
	for i := 0; i < len(value); i++ {
		ch := value[i]
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')) {
			return false
		}
	}
	return true
}

func validCaddyHostDBReservationRequest(input caddyHostDBReservationRequest) bool {
	if input.HTTPSRevision == 0 || input.HTTPSRevision >= 1<<60 ||
		input.CredentialRevision >= 1<<60 {
		return false
	}
	for _, digest := range []string{
		input.OperationSHA256, input.NonceSHA256, input.IntentSHA256,
		input.PlanSHA256, input.CandidateEnvironmentSHA256,
	} {
		if !validCaddyHostDBDigest(digest) {
			return false
		}
	}
	return true
}

// stageCaddyHostDBPendingUnapplied is deliberately NOT an HTTP/Agent/Host
// endpoint. Its only durable effect is one globally exclusive, sticky SQL
// pending record, protected by a PostgreSQL row lock on the current desired
// revision and (when present) the encrypted AliDNS metadata row.
//
// Even a committed pending record is NOT an Apply authorization: there is NO
// trusted host identity, signed actor admission, one-use nonce consumption,
// host filesystem CAS, secret delivery, restart, rescue, watchdog, or applied
// receipt here. Future host execution MUST independently re-validate the
// revisions and fence subsequent desired/credential edits, because rows can
// change AFTER this DB transaction commits.
func stageCaddyHostDBPendingUnapplied(ctx context.Context, db *gorm.DB,
	keyring *connectorsecret.Keyring, input caddyHostDBReservationRequest) error {
	if ctx == nil || db == nil || !validCaddyHostDBReservationRequest(input) {
		return errCaddyHostDBReservationBlocked
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var desired meta.AdminCaddyHTTPSSetting
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", caddyHTTPSSettingName).Take(&desired).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errCaddyHostDBReservationBlocked
			}
			return err
		}
		if desired.Revision != input.HTTPSRevision ||
			!validCaddyIngressSelection(desired.Enabled, desired.Domain,
				desired.LANEnabled, desired.LANIP) ||
			desired.Domain != strings.ToLower(desired.Domain) {
			return errCaddyHostDBReservationBlocked
		}

		var credential meta.AdminServiceSecret
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", caddyAliDNSSecretName).Take(&credential).Error
		exists := err == nil
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var credentialRevision uint64
		if exists {
			credentialRevision = credential.Revision
			if credentialRevision == 0 || credentialRevision >= 1<<60 {
				return errCaddyHostDBReservationBlocked
			}
		}
		if credentialRevision != input.CredentialRevision {
			return errCaddyHostDBReservationBlocked
		}
		if desired.Enabled {
			if !exists || !credential.Enabled || credential.KeyVersion == 0 ||
				len(credential.Ciphertext) == 0 || keyring == nil {
				return errCaddyHostDBReservationBlocked
			}
			plaintext, openErr := keyring.Open(caddyAliDNSSecretAADID,
				caddyAliDNSSecretKind, credential.KeyVersion, credential.Ciphertext)
			if openErr != nil {
				return errCaddyHostDBReservationBlocked
			}
			var pair caddyAliDNSSecretPair
			decodeErr := json.Unmarshal(plaintext, &pair)
			clear(plaintext)
			if decodeErr != nil || !validCaddyAliDNSPair(pair) {
				return errCaddyHostDBReservationBlocked
			}
		}
		snapshot := caddyPreflightSnapshot{
			Desired: adminCaddyHTTPSDesired{
				Revision: desired.Revision, Source: "saved",
				Enabled: desired.Enabled, Domain: desired.Domain,
				LANEnabled: desired.LANEnabled, LANIP: desired.LANIP,
			},
			CredentialExists: exists, Credential: credential,
		}
		plan, planErr := buildCaddyHTTPSHostPlan(snapshot)
		if planErr != nil {
			return errCaddyHostDBReservationBlocked
		}
		actual := sha256.Sum256(plan)
		if subtle.ConstantTimeCompare([]byte(fmt.Sprintf("%x", actual)),
			[]byte(input.PlanSHA256)) != 1 {
			return errCaddyHostDBReservationBlocked
		}

		var previous meta.AdminCaddyHostApplyReservation
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", caddyHostDBReservationName).Take(&previous).Error
		if err == nil {
			// Never implicitly reuse, expire or overwrite a pending nonce.
			// An independent, audited recovery protocol must decide its fate.
			return errCaddyHostDBReservationBlocked
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).
			Create(&meta.AdminCaddyHostApplyReservation{
				Name:                       caddyHostDBReservationName,
				HTTPSRevision:              input.HTTPSRevision,
				CredentialRevision:         input.CredentialRevision,
				OperationSHA256:            input.OperationSHA256,
				NonceSHA256:                input.NonceSHA256,
				IntentSHA256:               input.IntentSHA256,
				PlanSHA256:                 input.PlanSHA256,
				CandidateEnvironmentSHA256: input.CandidateEnvironmentSHA256,
				State:                      "pending-unapplied",
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errCaddyHostDBReservationBlocked
		}
		return nil
	})
}
