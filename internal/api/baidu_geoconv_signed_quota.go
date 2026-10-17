package api

import (
	"context"
	"crypto/ed25519"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// reserveBaiduGeoconvSignedAccountQuota is an INTERNAL candidate that
// composes the already-reviewed c5 proof verifier and the SINGLE c6
// atomic lower-cap reservation. It is NOT a production permission gate.
// The proof, expected live Owner/session/AK scope and test key are supplied
// by a trusted caller; there is deliberately no production caller or signer.
// The pinned production release gate remains unconditionally closed.
//
// Only ONE previously consented photo may be reserved per call. No AK is
// decrypted here, no GPS is read or transmitted, and no outgoing request
// or JSAPI4 Map/Loader/Cookie/Agent/Web route is activated.
func reserveBaiduGeoconvSignedAccountQuota(
	ctx context.Context, db *gorm.DB, ownerID uint64,
	proof baiduGeoconvAccountEvidenceProof,
	expected baiduGeoconvAccountEvidenceScope,
	trustedKey ed25519.PublicKey,
) error {
	denied := errBaiduGeoconvDispatchUnavailable
	if ctx == nil || ctx.Err() != nil || db == nil ||
		ownerID == 0 || ownerID > baiduGeoconvQuotaMaxOwnerID ||
		expected.OwnerID != ownerID || proof.Scope.OwnerID != ownerID {
		return denied
	}

	// The actual future approved caller MUST independently check the current
	// active Owner, SessionVersion, Server AK revision, account licence,
	// exact source GPS generation, opt-in consent, lease and flight capacity.
	// A cryptographically valid fixture alone cannot authorize provider egress.
	privateDB := db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	err := privateDB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var now time.Time
		if err := tx.Raw("SELECT clock_timestamp()").Row().Scan(&now); err != nil ||
			now.IsZero() || verifyBaiduGeoconvAccountEvidence(
			ctx, proof, trustedKey, expected, now,
		) != nil {
			return denied
		}

		// One and only one c6 reservation owns minute+second+UTC-day
		// fleet-first/Owner-second accounting in this SAME SQL transaction.
		// The nested GORM transaction uses a PostgreSQL savepoint: a later
		// denial rolls back ALL minute, point, second and day charges.
		if reserveBaiduGeoconvQuotaWithLowerAccountCaps(
			ctx, tx, ownerID, 1, proof.Scope.MinuteCaps, proof.Scope.CadenceCaps,
		) != nil {
			return denied
		}

		// A waiting PostgreSQL row lock may outlive this short-lived proof.
		// Use the database clock AFTER the quota reservation and before the
		// outer commit. Invalid or expired evidence rolls back every charge.
		now = time.Time{}
		if err := tx.Raw("SELECT clock_timestamp()").Row().Scan(&now); err != nil ||
			now.IsZero() || verifyBaiduGeoconvAccountEvidence(
			ctx, proof, trustedKey, expected, now,
		) != nil || ctx.Err() != nil {
			return denied
		}
		return nil
	})
	if err != nil || ctx.Err() != nil {
		// No SQL, Owner, signature, server credential or licensing details.
		return denied
	}
	return nil
}
