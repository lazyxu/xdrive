package api

import (
	"context"
	"crypto/ed25519"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// reserveBaiduGeoconvSignedProofAccountCaps is a PRIVATE, single-PhotoAsset
// quota-admission candidate. It composes the earlier c5 signed evidence
// verifier with the ONE existing c6 fleet-first/Owner-second lower-cap
// PostgreSQL transaction. There is no second counter or provider network path.
//
// trustedKey and expected are offline/test seams. A future independently
// reviewed Server release must instead obtain a pinned production trust root,
// current revocable Owner/session/Server AK revision, actual account-specific
// Baidu licence and lower signed quotas from authoritative Server state.
// Possessing a Server AK, an admin toggle, or an operator screenshot is NOT
// permission to convert/export a photo GPS pair.
//
// There is NO production caller, scheduler, REST/IPC route, JSAPI4 loader or
// public way to supply a key/proof. The pinned production evidence gate still
// denies unconditionally. An eventual dispatcher must recheck exact current
// PhotoAsset, original WGS84, consent, lease, capacity and entitlement.
func reserveBaiduGeoconvSignedProofAccountCaps(
	ctx context.Context, db *gorm.DB, ownerID uint64,
	proof baiduGeoconvAccountEvidenceProof,
	trustedKey ed25519.PublicKey,
	expected baiduGeoconvAccountEvidenceScope,
) error {
	denied := errBaiduGeoconvDispatchUnavailable
	if ctx == nil || ctx.Err() != nil || db == nil ||
		ownerID == 0 || ownerID > baiduGeoconvQuotaMaxOwnerID ||
		expected.OwnerID != ownerID || proof.Scope.OwnerID != ownerID ||
		len(trustedKey) != ed25519.PublicKeySize {
		return denied
	}
	// A successful cryptographic proof does not authorize production egress.
	// Keep all signed state out of SQL logs and durable quota rows.
	privateDB := db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	err := privateDB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var before time.Time
		if err := tx.Raw("SELECT clock_timestamp()").Row().Scan(&before); err != nil ||
			before.IsZero() ||
			verifyBaiduGeoconvAccountEvidence(ctx, proof, trustedKey, expected, before) != nil {
			return denied
		}

		// Exactly ONE point; no batching and no other quota implementation.
		// Existing lower caps are always constrained by source-owned maxima.
		// The nested reservation uses PostgreSQL savepoints; the outer
		// transaction owns the final commit/rollback of ALL dimensions.
		if err := reserveBaiduGeoconvQuotaWithLowerAccountCaps(
			ctx, tx, ownerID, 1, proof.Scope.MinuteCaps, proof.Scope.CadenceCaps,
		); err != nil {
			return denied
		}

		// Revalidate from PostgreSQL clock AFTER any fleet/Owner lock wait.
		// An expired/revoked request at this boundary rolls back the nested
		// minute, second and UTC-day charges atomically.
		var after time.Time
		if err := tx.Raw("SELECT clock_timestamp()").Row().Scan(&after); err != nil ||
			after.IsZero() ||
			verifyBaiduGeoconvAccountEvidence(ctx, proof, trustedKey, expected, after) != nil {
			return denied
		}
		return nil
	})
	if err != nil || ctx.Err() != nil {
		return denied
	}
	return nil
}
