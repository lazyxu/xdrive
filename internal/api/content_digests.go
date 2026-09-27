package api

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const contentDigestAlgorithmMD5 = "md5"

func verifiedDigestSHA256(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	algorithm, digest string,
	size int64,
) (string, bool, error) {
	algorithm = strings.ToLower(strings.TrimSpace(algorithm))
	digest = strings.ToLower(strings.TrimSpace(digest))
	if db == nil || ownerID == 0 || algorithm == "" || digest == "" || size < 0 {
		return "", false, nil
	}
	var alias meta.ContentDigestAlias
	if err := db.WithContext(ctx).
		Where("owner_id = ? AND algorithm = ? AND digest = ? AND size = ? AND state = ?",
			ownerID, algorithm, digest, size, meta.ContentDigestAliasStateReady).
		First(&alias).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", false, nil
		}
		return "", false, err
	}
	sha := strings.ToLower(strings.TrimSpace(alias.SHA256))
	if !validSHA256(sha) {
		return "", false, nil
	}
	return sha, true, nil
}

func recordVerifiedDigestAliasTx(
	tx *gorm.DB,
	ownerID uint64,
	algorithm, digest string,
	size int64,
	sha256Value string,
	now time.Time,
) error {
	algorithm = strings.ToLower(strings.TrimSpace(algorithm))
	digest = strings.ToLower(strings.TrimSpace(digest))
	sha256Value = strings.ToLower(strings.TrimSpace(sha256Value))
	if tx == nil || ownerID == 0 || algorithm == "" || digest == "" || size < 0 || !validSHA256(sha256Value) {
		return nil
	}
	row := meta.ContentDigestAlias{
		OwnerID: ownerID, Algorithm: algorithm, Digest: digest, Size: size,
		SHA256: sha256Value, State: meta.ContentDigestAliasStateReady,
		VerifiedAt: now,
	}
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "owner_id"}, {Name: "algorithm"}, {Name: "digest"}, {Name: "size"},
		},
		DoUpdates: clause.Assignments(map[string]any{
			"state": gorm.Expr(
				"CASE WHEN xd_content_digest_aliases.state = ? AND xd_content_digest_aliases.sha256 = EXCLUDED.sha256 THEN ? ELSE ? END",
				meta.ContentDigestAliasStateReady, meta.ContentDigestAliasStateReady, meta.ContentDigestAliasStateAmbiguous,
			),
			"sha256": gorm.Expr(
				"CASE WHEN xd_content_digest_aliases.state = ? AND xd_content_digest_aliases.sha256 = EXCLUDED.sha256 THEN xd_content_digest_aliases.sha256 ELSE '' END",
				meta.ContentDigestAliasStateReady,
			),
			"verified_at": gorm.Expr(
				"CASE WHEN xd_content_digest_aliases.state = ? AND xd_content_digest_aliases.sha256 = EXCLUDED.sha256 THEN EXCLUDED.verified_at ELSE xd_content_digest_aliases.verified_at END",
				meta.ContentDigestAliasStateReady,
			),
			"updated_at": now,
		}),
	}).Create(&row).Error
}
