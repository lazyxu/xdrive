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

var errBaiduPhotoMapWriteDenied = errors.New("baidu photo map index write unavailable")

// baiduPhotoMapWriteCandidate is constructed ONLY by a future trusted Server
// indexer after the official forward conversion has succeeded. The original
// GPS and versions must come from current Owner-authorized database rows;
// client metadata, a map viewport and legacy cell centres are not evidence.
type baiduPhotoMapWriteCandidate struct {
	OwnerID          uint64
	AssetID          uint64
	PrimaryNodeID    uint64
	NodeRevision     uint64
	MediaUpdatedAt   time.Time
	SourceLatitude   float64
	SourceLongitude  float64
	CoordinateSpace  string
	DerivedLatitude  float64
	DerivedLongitude float64
}

// baiduPhotoMapPrivacyCheck MUST independently verify the current owner and
// per-photo location-export/indexing policy IN THE SAME transaction and lock
// any durable policy rows on which that decision depends. No implementation
// is wired to production in A3b3a3d2j, so a nil check always denies.
// This callback is private Server code; never accept a browser boolean.
type baiduPhotoMapPrivacyCheck func(context.Context, *gorm.DB, uint64, uint64) error

func validBaiduPhotoMapWriteCandidate(c baiduPhotoMapWriteCandidate) (string, bool) {
	projection, ok := meta.BaiduPhotoMapProjectionForSpace(c.CoordinateSpace)
	if !ok || c.OwnerID == 0 || c.AssetID == 0 || c.PrimaryNodeID == 0 ||
		c.NodeRevision == 0 || c.MediaUpdatedAt.IsZero() {
		return "", false
	}
	for _, v := range []struct{ value, min, max float64 }{
		{c.SourceLatitude, -90, 90}, {c.SourceLongitude, -180, 180},
		{c.DerivedLatitude, -90, 90}, {c.DerivedLongitude, -180, 180},
	} {
		if math.IsNaN(v.value) || math.IsInf(v.value, 0) ||
			v.value < v.min || v.value > v.max {
			return "", false
		}
	}
	// Where Baidu's own regional map coordinate frame stays WGS84LL, no
	// offset, fake grid center or transformed BD09 coordinate is admissible.
	if c.CoordinateSpace == meta.BaiduPhotoMapSpaceWGS84LL &&
		(c.SourceLatitude != c.DerivedLatitude ||
			c.SourceLongitude != c.DerivedLongitude) {
		return "", false
	}
	return projection, true
}

// upsertBaiduPhotoMapPosition is a PRIVATE, non-routable, fail-closed sink for
// a future separately audited indexer. The privacy proof is checked against
// live Server state, not a saved caller boolean; current Source/Owner rows are
// locked until this one atomic transaction commits or rolls back.
//
// It does NOT call Baidu, read Server/Browser AK, mint Map cookies, create a
// public map API, launch background work, or authorize JSAPI4 production.
func upsertBaiduPhotoMapPosition(
	ctx context.Context, db *gorm.DB,
	candidate baiduPhotoMapWriteCandidate,
	verifyPrivacy baiduPhotoMapPrivacyCheck,
) error {
	denied := errBaiduPhotoMapWriteDenied
	projection, valid := validBaiduPhotoMapWriteCandidate(candidate)
	if ctx == nil || ctx.Err() != nil || db == nil ||
		verifyPrivacy == nil || !valid {
		return denied
	}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Lock in a stable order: account -> asset -> node -> metadata.
		// Concurrent deletes, node revisions and location edits must not
		// race an index write and resurrect a stale map location.
		var owner meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND disabled_at IS NULL AND must_change_password = ? AND session_version > 0",
				candidate.OwnerID, false).Take(&owner).Error; err != nil {
			return denied
		}
		var asset meta.PhotoAsset
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND primary_node_id = ?",
				candidate.AssetID, owner.ID, candidate.PrimaryNodeID).
			Take(&asset).Error; err != nil {
			return denied
		}
		var node meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL AND revision = ?",
				candidate.PrimaryNodeID, owner.ID, meta.NodeTypeFile,
				candidate.NodeRevision).Take(&node).Error; err != nil {
			return denied
		}
		var media meta.MediaMetadata
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("node_id = ? AND owner_id = ? AND node_revision = ? AND index_state = ? AND media_kind IN ?",
				node.ID, owner.ID, node.Revision, meta.MediaIndexStateReady,
				[]string{meta.MediaKindImage, meta.MediaKindVideo}).
			Take(&media).Error; err != nil {
			return denied
		}
		if media.Latitude == nil || media.Longitude == nil ||
			!media.UpdatedAt.Equal(candidate.MediaUpdatedAt) ||
			*media.Latitude != candidate.SourceLatitude ||
			*media.Longitude != candidate.SourceLongitude ||
			owner.ID != candidate.OwnerID || asset.ID != candidate.AssetID ||
			node.ID != candidate.PrimaryNodeID || ctx.Err() != nil {
			return denied
		}
		// The future real implementation must lock its persisted, revisioned
		// privacy/consent state; tests can inject a trusted synthetic checker.
		// A synthetic or future caller-provided callback is never sufficient:
		// acquire the separately persisted per-photo opt-in under the SAME
		// PostgreSQL transaction before storing any derived coordinates.
		consentRevision, consentErr := verifyBaiduPhotoMapConsentTx(ctx, tx, owner.ID, asset.ID)
		if consentErr != nil {
			return denied
		}
		if err := verifyPrivacy(ctx, tx, owner.ID, asset.ID); err != nil ||
			ctx.Err() != nil {
			return denied
		}
		record := meta.BaiduPhotoMapPosition{
			AssetID: asset.ID, OwnerID: owner.ID,
			PrimaryNodeID: node.ID, NodeRevision: node.Revision,
			MediaUpdatedAt:    media.UpdatedAt,
			ConsentRevision:   consentRevision,
			SourceLatitude:    candidate.SourceLatitude,
			SourceLongitude:   candidate.SourceLongitude,
			CoordinateSpace:   candidate.CoordinateSpace,
			ProjectionVersion: projection,
			Latitude:          candidate.DerivedLatitude,
			Longitude:         candidate.DerivedLongitude,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "asset_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"owner_id", "primary_node_id", "node_revision",
				"media_updated_at", "consent_revision", "source_latitude", "source_longitude",
				"coordinate_space", "projection_version", "latitude",
				"longitude", "updated_at",
			}),
		}).Create(&record).Error; err != nil {
			return denied
		}
		return nil
	})
	if err != nil {
		return denied
	}
	return nil
}

// purgeBaiduPhotoMapPosition is an Owner-scoped private cleanup operation.
// It remains available for deletion/revocation even if the user is disabled.
// No HTTP route or background worker invokes it in this phase.
func purgeBaiduPhotoMapPosition(ctx context.Context, db *gorm.DB, ownerID, assetID uint64) error {
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 || assetID == 0 {
		return errBaiduPhotoMapWriteDenied
	}
	if err := db.WithContext(ctx).Where("owner_id = ? AND asset_id = ?", ownerID, assetID).
		Delete(&meta.BaiduPhotoMapPosition{}).Error; err != nil {
		return errBaiduPhotoMapWriteDenied
	}
	return nil
}
