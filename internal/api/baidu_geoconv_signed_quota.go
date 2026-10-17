package api

import (
	"context"
	"crypto/ed25519"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// reserveBaiduGeoconvSignedAccountQuota is a PRIVATE transaction primitive,
// not a production licence/permit or a provider dispatcher. The trusted
// account evidence, public key and expected live Owner/session/AK revision
// must eventually come from independently approved Server-only state.
//
// In particular, the Browser JSAPI AK and the operator's reported 3 QPS /
// 5,000-per-day console screenshot cannot authorize calling this method.
// No production caller or signer exists and the pinned production proof gate
// remains unconditionally closed. One call reserves ONE current photo only.
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

	// The future approved caller must still first check live operator
	// entitlement and exact Owner/source/PhotoAsset/consent/lease/capacity.
	// This isolated admission NEVER invokes a converter or reads an AK.
	privateDB := db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	err := privateDB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var now time.Time
		if err := tx.Raw("SELECT clock_timestamp()").Row().Scan(&now); err != nil || now.IsZero() {
			return denied
		}
		if verifyBaiduGeoconvAccountEvidence(ctx, proof, trustedKey, expected, now) != nil {
			return denied
		}
		// Reuse existing fleet-FIRST / Owner-SECOND minute request and point
		// reservation, but with LOWER signed, locally bounded caps.
		if reserveBaiduGeoconvQuotaWithLimits(
			ctx, tx, ownerID, 1, proof.Scope.MinuteCaps,
		) != nil {
			return denied
		}
		// Recheck the current PostgreSQL clock AFTER any minute-row lock wait,
		// before second/day admission. If proof expired while waiting, the
		// outer transaction rolls back the earlier fleet/Owner minute writes.
		if err := tx.Raw("SELECT clock_timestamp()").Row().Scan(&now); err != nil || now.IsZero() ||
			verifyBaiduGeoconvAccountEvidence(ctx, proof, trustedKey, expected, now) != nil {
			return denied
		}
		second := now.Unix()
		if reserveBaiduGeoconvCadenceAt(
			ctx, tx, ownerID, second, second/86400, proof.Scope.CadenceCaps,
		) != nil || ctx.Err() != nil {
			return denied
		}
		// If the request was revoked while a DB row was locked, never keep
		// a partially consumed minute/second/day budget.
		if ctx.Err() != nil {
			return denied
		}
		return nil
	})
	if err != nil || ctx.Err() != nil {
		return denied
	}
	return nil
}
