package api

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errBaiduPhotoMapConsentDenied = errors.New("baidu photo map consent unavailable")

type baiduPhotoMapConsentSource struct {
	NodeID         uint64
	NodeRevision   uint64
	MediaUpdatedAt time.Time
	Latitude       float64
	Longitude      float64
}

// verifyBaiduPhotoMapConsentTx is the mandatory, independent DB privacy gate
// for any future private indexed-position writer. Its caller already holds
// Owner -> PhotoAsset -> primary Node -> MediaMetadata locks in the SAME tx.
// Revalidate the specific GPS pair and media generation explicitly authorized
// by the Owner, not merely the current actor or consent revision. Old rows
// lacking a fingerprint fail closed even after a source mutation.
// No client bool or synthetic callback can replace this row and its lock.
func verifyBaiduPhotoMapConsentTx(ctx context.Context, tx *gorm.DB, ownerID, assetID uint64, fingerprints ...baiduPhotoMapConsentSource) (uint64, error) {
	if ctx == nil || ctx.Err() != nil || tx == nil || ownerID == 0 || assetID == 0 ||
		len(fingerprints) != 1 {
		return 0, errBaiduPhotoMapConsentDenied
	}
	source := fingerprints[0]
	if source.NodeID == 0 || source.NodeRevision == 0 || source.MediaUpdatedAt.IsZero() ||
		math.IsNaN(source.Latitude) || math.IsInf(source.Latitude, 0) ||
		math.IsNaN(source.Longitude) || math.IsInf(source.Longitude, 0) ||
		source.Latitude < -90 || source.Latitude > 90 ||
		source.Longitude < -180 || source.Longitude > 180 {
		return 0, errBaiduPhotoMapConsentDenied
	}
	var consent meta.BaiduPhotoMapConsent
	err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("owner_id = ? AND asset_id = ? AND revision > 0 AND allow_index = ? AND allow_baidu_conversion = ? AND revoked_at IS NULL AND expires_at > clock_timestamp() AND source_node_id = ? AND source_node_revision = ? AND source_media_updated_at = ? AND source_latitude = ? AND source_longitude = ?",
			ownerID, assetID, true, true, source.NodeID, source.NodeRevision,
			source.MediaUpdatedAt, source.Latitude, source.Longitude).
		Take(&consent).Error
	if err != nil || consent.Revision == 0 || ctx.Err() != nil {
		return 0, errBaiduPhotoMapConsentDenied
	}
	return consent.Revision, nil
}

// revokeBaiduPhotoMapConsent atomically revokes a specific current owner/asset
// opt-in and purges its derived position. It works for disabled users too;
// future logout/privacy UI must authorize its caller independently.
// A revision CAS prevents stale consent edits from undoing a revocation.
func revokeBaiduPhotoMapConsent(ctx context.Context, db *gorm.DB, ownerID, assetID, expectedRevision uint64) error {
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 || assetID == 0 ||
		expectedRevision == 0 || expectedRevision == ^uint64(0) {
		return errBaiduPhotoMapConsentDenied
	}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Match the writer's locking order to avoid deadlocks with ingestion.
		var owner meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", ownerID).Take(&owner).Error; err != nil {
			return errBaiduPhotoMapConsentDenied
		}
		var asset meta.PhotoAsset
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", assetID, owner.ID).Take(&asset).Error; err != nil {
			return errBaiduPhotoMapConsentDenied
		}
		var consent meta.BaiduPhotoMapConsent
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("asset_id = ? AND owner_id = ? AND revision = ?", asset.ID, owner.ID, expectedRevision).
			Take(&consent).Error; err != nil {
			return errBaiduPhotoMapConsentDenied
		}
		if consent.RevokedAt != nil || consent.Revision != expectedRevision || ctx.Err() != nil {
			return errBaiduPhotoMapConsentDenied
		}
		now := time.Now().UTC()
		result := tx.Model(&meta.BaiduPhotoMapConsent{}).
			Where("asset_id = ? AND owner_id = ? AND revision = ?", asset.ID, owner.ID, expectedRevision).
			Updates(map[string]any{
				"allow_index": false, "allow_baidu_conversion": false,
				"revoked_at": now, "revision": consent.Revision + 1,
			})
		if result.Error != nil || result.RowsAffected != 1 {
			return errBaiduPhotoMapConsentDenied
		}
		if err := tx.Where("asset_id = ? AND owner_id = ?", asset.ID, owner.ID).
			Delete(&meta.BaiduPhotoMapPosition{}).Error; err != nil {
			return errBaiduPhotoMapConsentDenied
		}
		return nil
	})
	if err != nil {
		return errBaiduPhotoMapConsentDenied
	}
	return nil
}
