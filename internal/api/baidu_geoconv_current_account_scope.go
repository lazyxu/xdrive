package api

import (
	"context"
	"crypto/ed25519"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

// baiduGeoconvTrustedEvidenceReference is a PRIVATE, unprovisioned source
// contract for a future independently licensed/account-scoped attestation.
// Its values MUST come from an approved, revocable Server authority, never
// from the Browser, a public route, an administrator enabled flag, an AK,
// the signed proof itself, or the operator's quota screenshot.
type baiduGeoconvTrustedEvidenceReference struct {
	Revision    uint64
	Digest      [32]byte
	MinuteCaps  baiduGeoconvQuotaLimits
	CadenceCaps baiduGeoconvCadenceCaps
}

// reserveCurrentBaiduGeoconvSignedAccountQuota only composes current DB
// identity and encrypted Server AK revision with the already approved c7
// PRIVATE signature+quota transaction. This is NOT a production dispatcher.
// No production evidence authority, pinned signer, HTTP route, scheduler,
// provider call or other caller is installed. The production pinned proof
// gate remains unconditionally CLOSED.
//
// Require a saved, enabled, AEAD-verifiable Server-type AK revision: there
// is intentionally NO deployment-env fallback for signed-revision admission
// and NO possible substitution of the separate JSAPI Browser AK.
//
// PostgreSQL FOR SHARE on the exact Owner and Server service-secret rows
// prevents session revocation, password reset and AK rotation from changing
// those identities before the quota transaction commits. It does not grant
// permission to send GPS after this transaction; a future legitimate sender
// still needs exact source/consent/lease/current entitlement checks before
// dispatch and must honor cancellation.
func (s *Server) reserveCurrentBaiduGeoconvSignedAccountQuota(
	ctx context.Context, ownerID uint64, proof baiduGeoconvAccountEvidenceProof,
	reviewed baiduGeoconvTrustedEvidenceReference, trustedKey ed25519.PublicKey,
) error {
	denied := errBaiduGeoconvDispatchUnavailable
	if s == nil || s.DB == nil || s.ConnectorSecrets == nil ||
		ctx == nil || ctx.Err() != nil ||
		ownerID == 0 || ownerID > baiduGeoconvQuotaMaxOwnerID ||
		len(trustedKey) != ed25519.PublicKeySize {
		return denied
	}
	runCtx, cancel := context.WithTimeout(ctx, baiduMapIndexExecutionTimeout)
	defer cancel()
	privateDB := s.DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	err := privateDB.WithContext(runCtx).Transaction(func(tx *gorm.DB) error {
		// These two row locks remain held across the nested c7 quota
		// reservation, preventing a different Server from rotating the
		// credential or revoking the Owner until this transaction closes.
		var owner meta.User
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Select("id", "session_version", "disabled_at", "must_change_password").
			Where("id = ?", ownerID).Take(&owner).Error; err != nil ||
			owner.ID != ownerID || owner.SessionVersion == 0 ||
			owner.DisabledAt != nil || owner.MustChangePassword {
			return denied
		}
		var serverAK meta.AdminServiceSecret
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Select("name", "enabled", "revision", "key_version", "ciphertext").
			Where("name = ?", baiduMapSecretName).Take(&serverAK).Error; err != nil ||
			serverAK.Name != baiduMapSecretName || !serverAK.Enabled ||
			serverAK.Revision == 0 || serverAK.KeyVersion == 0 ||
			len(serverAK.Ciphertext) == 0 {
			return denied
		}
		// This credential is checked only for a current valid Server
		// secret; the plaintext NEVER leaves this function and is cleared.
		plaintext, openErr := s.ConnectorSecrets.Open(
			baiduMapSecretAADID, baiduMapSecretKind,
			serverAK.KeyVersion, serverAK.Ciphertext,
		)
		if openErr != nil {
			return denied
		}
		valid := len(plaintext) > 0 && len(plaintext) <= maxBaiduMapAKBytes
		for _, ch := range plaintext {
			if ch < '!' || ch > '~' {
				valid = false
			}
		}
		clear(plaintext)
		if !valid || runCtx.Err() != nil {
			return denied
		}

		// Only current identity/AK revision are read from DB. The
		// reviewed evidence digest, revision and lower limits remain
		// independent of the untrusted candidate proof.
		expected := baiduGeoconvAccountEvidenceScope{
			OwnerID: owner.ID, SessionVersion: owner.SessionVersion,
			ServerAKRevision: serverAK.Revision,
			EvidenceRevision: reviewed.Revision,
			EvidenceSHA256:   reviewed.Digest,
			MinuteCaps:       reviewed.MinuteCaps,
			CadenceCaps:      reviewed.CadenceCaps,
		}
		// Exactly ONE current Owner photo quota point and ONE existing c6
		// fleet+Owner writer; invalid evidence or SQL denial rolls back
		// all counters together, including the outer transaction.
		if reserveBaiduGeoconvSignedAccountQuota(
			runCtx, tx, ownerID, proof, expected, trustedKey,
		) != nil || runCtx.Err() != nil {
			return denied
		}
		return nil
	})
	if err != nil || runCtx.Err() != nil {
		return denied
	}
	return nil
}
