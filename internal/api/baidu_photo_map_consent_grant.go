package api

import (
	"context"
	"errors"
	"math"
	"strconv"
	"time"

	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errBaiduPhotoMapGrantDenied = errors.New("baidu photo map consent grant unavailable")

const (
	baiduPhotoMapGrantMinimumLifetime = 5 * time.Minute
	baiduPhotoMapGrantMaximumLifetime = 30 * 24 * time.Hour
)

// baiduPhotoMapGrantCandidate MUST be constructed from a verified, explicit
// Owner decision. A future HTTP endpoint must authenticate the actor first;
// there is no production grant caller or route in this phase. The original
// WGS84 pair and revisions are revalidated from locked Server rows.
type baiduPhotoMapGrantCandidate struct {
	OwnerID                 uint64
	AssetID                 uint64
	PrimaryNodeID           uint64
	NodeRevision            uint64
	MediaUpdatedAt          time.Time
	SourceLatitude          float64
	SourceLongitude         float64
	ExpectedConsentRevision uint64
	ExpiresAt               time.Time
}

// The trusted caller must re-check the explicit, current owner's decision
// inside the same transaction. Test-only callbacks are not production proof.
// A nil callback, a different actor or any failed check MUST deny the grant.
type baiduPhotoMapGrantDecision func(context.Context, *gorm.DB, uint64, uint64) (auditpkg.Event, error)

func validBaiduPhotoMapGrantCandidate(c baiduPhotoMapGrantCandidate) bool {
	return c.OwnerID != 0 && c.AssetID != 0 && c.PrimaryNodeID != 0 &&
		c.NodeRevision != 0 && c.MediaUpdatedAt.IsZero() == false &&
		c.ExpiresAt.IsZero() == false && c.ExpectedConsentRevision != ^uint64(0) &&
		!math.IsNaN(c.SourceLatitude) && !math.IsInf(c.SourceLatitude, 0) &&
		!math.IsNaN(c.SourceLongitude) && !math.IsInf(c.SourceLongitude, 0) &&
		c.SourceLatitude >= -90 && c.SourceLatitude <= 90 &&
		c.SourceLongitude >= -180 && c.SourceLongitude <= 180
}

// grantBaiduPhotoMapConsent is a PRIVATE, non-routable consent transaction.
// It never uses or reveals either Baidu AK, calls Baidu Geoconv, creates a
// background indexer or mints a Map Session. There is intentionally no
// default user opt-in and no production decision callback yet.
func grantBaiduPhotoMapConsent(
	ctx context.Context, db *gorm.DB, candidate baiduPhotoMapGrantCandidate,
	verifyDecision baiduPhotoMapGrantDecision,
) (meta.BaiduPhotoMapConsent, error) {
	denied := errBaiduPhotoMapGrantDenied
	if ctx == nil || ctx.Err() != nil || db == nil || verifyDecision == nil ||
		!validBaiduPhotoMapGrantCandidate(candidate) {
		return meta.BaiduPhotoMapConsent{}, denied
	}
	var saved meta.BaiduPhotoMapConsent
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Maintain the writer/revoke lock order: Owner -> Asset -> Node ->
		// MediaMetadata -> consent. Source edits or revokes cannot slip through.
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
				candidate.PrimaryNodeID, owner.ID, meta.NodeTypeFile, candidate.NodeRevision).
			Take(&node).Error; err != nil {
			return denied
		}
		var media meta.MediaMetadata
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("node_id = ? AND owner_id = ? AND node_revision = ? AND index_state = ? AND media_kind IN ?",
				node.ID, owner.ID, node.Revision, meta.MediaIndexStateReady,
				[]string{meta.MediaKindImage, meta.MediaKindVideo}).Take(&media).Error; err != nil {
			return denied
		}
		if media.Latitude == nil || media.Longitude == nil ||
			!media.UpdatedAt.Equal(candidate.MediaUpdatedAt) ||
			*media.Latitude != candidate.SourceLatitude ||
			*media.Longitude != candidate.SourceLongitude || ctx.Err() != nil {
			return denied
		}
		var databaseNow time.Time
		if err := tx.Raw("SELECT clock_timestamp()").Row().Scan(&databaseNow); err != nil {
			return denied
		}
		lifetime := candidate.ExpiresAt.Sub(databaseNow)
		if lifetime < baiduPhotoMapGrantMinimumLifetime || lifetime > baiduPhotoMapGrantMaximumLifetime {
			return denied
		}
		// The caller's explicit authenticated-user attestation must come from
		// independent Server state; a client-provided boolean is never enough.
		actor, err := verifyDecision(ctx, tx, owner.ID, asset.ID)
		if err != nil || actor.ActorUserID == nil || *actor.ActorUserID != owner.ID || ctx.Err() != nil {
			return denied
		}
		var old meta.BaiduPhotoMapConsent
		readErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("asset_id = ? AND owner_id = ?", asset.ID, owner.ID).Take(&old).Error
		switch {
		case errors.Is(readErr, gorm.ErrRecordNotFound):
			if candidate.ExpectedConsentRevision != 0 {
				return denied
			}
			// Copy ONLY the freshly locked metadata pair. The caller's proposed
			// latitude/longitude was independently compared above, but is never
			// trusted as a source of persisted authorization.
			latitude, longitude := *media.Latitude, *media.Longitude
			mediaUpdatedAt := media.UpdatedAt
			saved = meta.BaiduPhotoMapConsent{
				AssetID: asset.ID, OwnerID: owner.ID, Revision: 1,
				AllowIndex: true, AllowBaiduConversion: true,
				ExpiresAt:    candidate.ExpiresAt.UTC(),
				SourceNodeID: node.ID, SourceNodeRevision: node.Revision,
				SourceMediaUpdatedAt: &mediaUpdatedAt,
				SourceLatitude:       &latitude, SourceLongitude: &longitude,
			}
			if err := tx.Create(&saved).Error; err != nil {
				return denied
			}
		case readErr != nil || old.Revision == 0 ||
			old.Revision != candidate.ExpectedConsentRevision ||
			old.Revision == ^uint64(0):
			return denied
		default:
			updated := tx.Model(&meta.BaiduPhotoMapConsent{}).
				Where("asset_id = ? AND owner_id = ? AND revision = ?",
					asset.ID, owner.ID, old.Revision).
				Updates(map[string]any{
					"revision":    old.Revision + 1,
					"allow_index": true, "allow_baidu_conversion": true,
					"revoked_at": nil, "expires_at": candidate.ExpiresAt.UTC(),
					"source_node_id":          node.ID,
					"source_node_revision":    node.Revision,
					"source_media_updated_at": media.UpdatedAt,
					"source_latitude":         *media.Latitude,
					"source_longitude":        *media.Longitude,
				})
			if updated.Error != nil || updated.RowsAffected != 1 {
				return denied
			}
			if err := tx.Where("asset_id = ? AND owner_id = ?", asset.ID, owner.ID).
				Take(&saved).Error; err != nil {
				return denied
			}
		}
		// Source changes require a NEW independently authorized grant and
		// monotonic revision even when a previous consent has not expired.
		// Policy revision itself invalidates old positions. Purging in the
		// same transaction additionally bounds retention after a new consent.
		if err := tx.Where("asset_id = ? AND owner_id = ?", asset.ID, owner.ID).
			Delete(&meta.BaiduPhotoMapPosition{}).Error; err != nil {
			return denied
		}
		// Audit failure rolls back BOTH grant and derivative purge. Never
		// record raw GPS, Browser/Server AK, JWT or photo paths.
		if err := auditpkg.Record(tx, auditpkg.Event{
			ActorUserID:   actor.ActorUserID,
			ActorUsername: owner.Username, ActorRole: owner.Role,
			Action: "media.photo_map.consent.grant", TargetType: "photo_asset",
			TargetID: strconv.FormatUint(asset.ID, 10), Result: auditpkg.ResultSuccess,
			RequestID: actor.RequestID, IPAddress: actor.IPAddress,
			Metadata: map[string]any{"revision": saved.Revision, "purpose": "baidu-forward-map-index"},
		}); err != nil {
			return denied
		}
		return nil
	})
	if err != nil {
		return meta.BaiduPhotoMapConsent{}, denied
	}
	return saved, nil
}
