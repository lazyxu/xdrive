package api

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

const baiduJSAPIBrowserAKReadTimeout = 2 * time.Second

// currentBaiduJSAPIBrowserAKCandidate is a PRIVATE credential reader for a
// future, separately licensed and authenticated same-origin JSAPI4 proxy.
// It is deliberately NOT a production permission or network entry point.
//
// A trusted Server caller must first obtain a CURRENT, production-approved
// map resource session/release proof. Today every real candidate state has
// RuntimeAuthorized=false, and no production caller, Loader, map Cookie or
// dynamic resource proxy is wired. A synthetic true fixture proves only that
// current DB session/config isolation works, never that release is approved.
//
// Only the independently encrypted JSAPI4 Browser-type AK is returned, NEVER
// the Static/Web-Service Server AK or a deployment environment fallback.
func (s *Server) currentBaiduJSAPIBrowserAKCandidate(
	ctx context.Context, current baidumapjsapi.MapSessionState,
) (string, error) {
	denied := errBaiduJSAPIResourceDenied
	if s == nil || s.DB == nil || s.ConnectorSecrets == nil ||
		ctx == nil || ctx.Err() != nil ||
		current.OwnerID == 0 || current.OwnerID > baiduGeoconvQuotaMaxOwnerID ||
		current.SessionVersion == 0 || current.ConfigurationRevision == 0 ||
		current.RevocationEpoch == 0 ||
		!current.AccountActive || !current.RuntimeAuthorized {
		return "", denied
	}

	readCtx, cancel := context.WithTimeout(ctx, baiduJSAPIBrowserAKReadTimeout)
	defer cancel()
	db := s.DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	var browserAK string
	err := db.WithContext(readCtx).Transaction(func(tx *gorm.DB) error {
		// Lock current account, map-only revocation and desired Browser AK
		// revision during decryption; other Server replicas' updates must
		// not race this credential snapshot. Locks are released at return,
		// NOT held across a future upstream HTTP call.
		var owner meta.User
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Select("id", "session_version", "disabled_at", "must_change_password").
			Where("id = ?", current.OwnerID).Take(&owner).Error; err != nil ||
			owner.ID != current.OwnerID || owner.SessionVersion == 0 ||
			owner.SessionVersion != current.SessionVersion ||
			owner.DisabledAt != nil || owner.MustChangePassword {
			return denied
		}
		var epoch meta.BaiduJSAPIMapEpoch
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Select("owner_id", "epoch").
			Where("owner_id = ?", current.OwnerID).Take(&epoch).Error; err != nil ||
			epoch.OwnerID != current.OwnerID || epoch.Epoch == 0 ||
			epoch.Epoch != current.RevocationEpoch {
			return denied
		}
		var secret meta.AdminServiceSecret
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Select("name", "enabled", "revision", "key_version", "ciphertext").
			Where("name = ?", baiduJSAPISecretName).Take(&secret).Error; err != nil ||
			secret.Name != baiduJSAPISecretName || !secret.Enabled ||
			secret.Revision == 0 || secret.Revision != current.ConfigurationRevision ||
			secret.KeyVersion == 0 || len(secret.Ciphertext) == 0 {
			return denied
		}
		plaintext, err := s.ConnectorSecrets.Open(
			baiduJSAPISecretAADID, baiduJSAPISecretKind,
			secret.KeyVersion, secret.Ciphertext,
		)
		if err != nil {
			return denied
		}
		valid := len(plaintext) > 0 && len(plaintext) <= maxBaiduMapAKBytes
		for _, b := range plaintext {
			if b < '!' || b > '~' {
				valid = false
			}
		}
		if valid && readCtx.Err() == nil {
			browserAK = string(plaintext)
		}
		clear(plaintext)
		if !valid || readCtx.Err() != nil {
			return denied
		}
		return nil
	})
	if err != nil || readCtx.Err() != nil {
		return "", denied
	}
	return browserAK, nil
}
