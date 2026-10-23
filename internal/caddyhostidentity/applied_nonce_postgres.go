package caddyhostidentity

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const appliedNonceHashDomain = "xdrive.caddy.applied-receipt.nonce.v1\n"

// validAppliedNonceInput accepts ONLY the opaque, lower-case 128-bit nonce
// from the already verified canonical signed envelope, with trusted operator
// pins bound by the verifier. No HTTP/Agent/Host request can call this as an
// authorization to deploy Caddy.
func validAppliedNonceInput(nonce string, pins AppliedPins) bool {
	if len(nonce) != 32 || len(pins.OperationID) != 24 {
		return false
	}
	for _, value := range []string{
		pins.PublicKeyDER_SHA256, pins.CollectorID, pins.HostID, pins.ServerID,
		pins.EnvSHA, pins.GenerationSHA, pins.ConfigSHA,
	} {
		if !validDigest(value) {
			return false
		}
	}
	for _, value := range []string{nonce, pins.OperationID} {
		for i := 0; i < len(value); i++ {
			c := value[i]
			if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
				return false
			}
		}
	}
	return true
}

// DurableAppliedNonceConsumer is the trusted caller's atomic callback for
// VerifyAppliedReceipt. PostgreSQL PRIMARY KEY + INSERT ON CONFLICT DO NOTHING
// admits exactly one consumer across all Server replicas, crashes, retries,
// processes and independent signed operations, even when the original ACK is
// lost. DB failure and duplicate nonce ALWAYS fail closed.
//
// The ledger is deliberately append-only: a short receipt TTL is NOT a reason
// to delete consumed nonces and permit signed nonce reuse. Keep this unexposed
// until an independently trusted real Host Collector and negative probes exist.
// A successful nonce insert is NOT an Applied or ongoing health assertion.
func DurableAppliedNonceConsumer(ctx context.Context, db *gorm.DB, pins AppliedPins) func(string) error {
	return func(nonce string) error {
		if ctx == nil || db == nil || ctx.Err() != nil || !validAppliedNonceInput(nonce, pins) {
			return errAppliedUntrusted
		}
		fingerprint := sha256.Sum256([]byte(appliedNonceHashDomain + nonce))
		row := meta.AdminCaddyAppliedNonce{
			NonceSHA256:         hex.EncodeToString(fingerprint[:]),
			CollectorID:         pins.CollectorID,
			HostID:              pins.HostID,
			ServerID:            pins.ServerID,
			OperationID:         pins.OperationID,
			PublicKeyDER_SHA256: pins.PublicKeyDER_SHA256,
			EnvSHA:              pins.EnvSHA,
			GenerationSHA:       pins.GenerationSHA,
			ConfigSHA:           pins.ConfigSHA,
			ConsumedAt:          time.Now().UTC(),
		}
		result := db.WithContext(ctx).
			Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
		if result.Error != nil || result.RowsAffected != 1 {
			return errAppliedUntrusted
		}
		return nil
	}
}
