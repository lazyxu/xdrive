package api

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	baiduMapIndexQueued    = "queued"
	baiduMapIndexLeased    = "leased"
	baiduMapIndexCancelled = "cancelled"
	baiduMapIndexMaxClaims = 3
	baiduMapIndexLeaseTTL  = 20 * time.Second
)

var errBaiduMapIndexIntentDenied = errors.New("baidu photo map index intent unavailable")

// An internal-only snapshot obtained from locked, current Server PostgreSQL
// records. Never trust a viewport, browser, grid center or queued job for GPS.
type baiduMapIndexSource struct {
	ownerID, assetID, nodeID, nodeRevision uint64
	sessionVersion, consentRevision        uint64
	mediaUpdatedAt                         time.Time
	latitude, longitude                    float64
}

type baiduMapIndexLease struct {
	source  baiduMapIndexSource
	token   string
	until   time.Time
	attempt uint32
}

func baiduMapIndexClockTx(tx *gorm.DB) (time.Time, error) {
	var now time.Time
	if err := tx.Raw("SELECT clock_timestamp()").Row().Scan(&now); err != nil || now.IsZero() {
		return time.Time{}, errBaiduMapIndexIntentDenied
	}
	return now, nil
}

// All index queue operations use the same lock order as the existing private
// index writer: Owner -> PhotoAsset -> Node -> MediaMetadata -> consent ->
// intent. This helper MUST be called inside the caller's transaction.
// Consent revocation, account/session changes and source edits fail closed.
// This private path does not enqueue or send GPS automatically.
func lockBaiduMapIndexSourceTx(
	ctx context.Context, tx *gorm.DB, ownerID, assetID uint64,
) (baiduMapIndexSource, error) {
	var none baiduMapIndexSource
	if ctx == nil || ctx.Err() != nil || tx == nil || ownerID == 0 || assetID == 0 {
		return none, errBaiduMapIndexIntentDenied
	}
	var owner meta.User
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND disabled_at IS NULL AND must_change_password = ? AND session_version > 0", ownerID, false).
		Take(&owner).Error; err != nil {
		return none, errBaiduMapIndexIntentDenied
	}
	var asset meta.PhotoAsset
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ?", assetID, owner.ID).
		Take(&asset).Error; err != nil ||
		(asset.Kind != meta.PhotoAssetKindImage && asset.Kind != meta.PhotoAssetKindVideo) {
		return none, errBaiduMapIndexIntentDenied
	}
	var node meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL AND revision > 0",
			asset.PrimaryNodeID, owner.ID, meta.NodeTypeFile).
		Take(&node).Error; err != nil {
		return none, errBaiduMapIndexIntentDenied
	}
	var media meta.MediaMetadata
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("node_id = ? AND owner_id = ? AND node_revision = ? AND index_state = ? AND media_kind IN ?",
			node.ID, owner.ID, node.Revision, meta.MediaIndexStateReady,
			[]string{meta.MediaKindImage, meta.MediaKindVideo}).
		Take(&media).Error; err != nil || media.UpdatedAt.IsZero() ||
		media.Latitude == nil || media.Longitude == nil {
		return none, errBaiduMapIndexIntentDenied
	}
	lat, lng := *media.Latitude, *media.Longitude
	if math.IsNaN(lat) || math.IsInf(lat, 0) || lat < -90 || lat > 90 ||
		math.IsNaN(lng) || math.IsInf(lng, 0) || lng < -180 || lng > 180 ||
		ctx.Err() != nil {
		return none, errBaiduMapIndexIntentDenied
	}
	rev, err := verifyBaiduPhotoMapConsentTx(ctx, tx, owner.ID, asset.ID, baiduPhotoMapConsentSource{
		NodeID: node.ID, NodeRevision: node.Revision,
		MediaUpdatedAt: media.UpdatedAt, Latitude: lat, Longitude: lng,
	})
	if err != nil || rev == 0 || ctx.Err() != nil {
		return none, errBaiduMapIndexIntentDenied
	}
	return baiduMapIndexSource{
		ownerID: owner.ID, assetID: asset.ID, nodeID: node.ID,
		nodeRevision: node.Revision, sessionVersion: owner.SessionVersion,
		mediaUpdatedAt: media.UpdatedAt, consentRevision: rev,
		latitude: lat, longitude: lng,
	}, nil
}

// time.Time values from independent PostgreSQL reads must be compared by
// instant, not by Go struct identity/location pointer.
func baiduMapIndexSourcesEqual(a, b baiduMapIndexSource) bool {
	return a.ownerID == b.ownerID && a.assetID == b.assetID &&
		a.nodeID == b.nodeID && a.nodeRevision == b.nodeRevision &&
		a.sessionVersion == b.sessionVersion &&
		a.consentRevision == b.consentRevision &&
		a.mediaUpdatedAt.Equal(b.mediaUpdatedAt) &&
		a.latitude == b.latitude && a.longitude == b.longitude
}

func baiduMapIndexIntentMatches(row meta.BaiduPhotoMapIndexIntent, source baiduMapIndexSource) bool {
	return row.AssetID == source.assetID && row.OwnerID == source.ownerID &&
		row.PrimaryNodeID == source.nodeID && row.NodeRevision == source.nodeRevision &&
		row.MediaUpdatedAt.Equal(source.mediaUpdatedAt) &&
		row.ConsentRevision == source.consentRevision &&
		row.SessionVersion == source.sessionVersion
}

// enqueueBaiduPhotoMapIndexIntent is a PRIVATE, explicit decision-driven
// entry point. No API, automatic media backfill, scheduler or network caller is
// wired to it. Only a real, current Server opt-in matching expectedRevision
// can persist a bounded one-photo intent. No original GPS or AK is persisted.
func enqueueBaiduPhotoMapIndexIntent(
	ctx context.Context, db *gorm.DB, ownerID, assetID, expectedRevision uint64,
) error {
	denied := errBaiduMapIndexIntentDenied
	if ctx == nil || ctx.Err() != nil || db == nil ||
		ownerID == 0 || assetID == 0 || expectedRevision == 0 {
		return denied
	}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		source, err := lockBaiduMapIndexSourceTx(ctx, tx, ownerID, assetID)
		if err != nil || source.consentRevision != expectedRevision {
			return denied
		}
		var old meta.BaiduPhotoMapIndexIntent
		err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("asset_id = ?", assetID).Take(&old).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return tx.Create(&meta.BaiduPhotoMapIndexIntent{
				AssetID: assetID, OwnerID: ownerID, PrimaryNodeID: source.nodeID,
				NodeRevision: source.nodeRevision, MediaUpdatedAt: source.mediaUpdatedAt,
				ConsentRevision: source.consentRevision, SessionVersion: source.sessionVersion,
				Status: baiduMapIndexQueued,
			}).Error
		}
		if err != nil || old.OwnerID != ownerID {
			return denied
		}
		if baiduMapIndexIntentMatches(old, source) {
			if old.Status == baiduMapIndexQueued || old.Status == baiduMapIndexLeased {
				return nil // idempotent: never create a second claimable job
			}
			return denied // explicit cancellation cannot be undone by replay
		}
		if source.consentRevision <= old.ConsentRevision ||
			old.Status == baiduMapIndexLeased {
			return denied // requires a fresh grant and old lease cancellation
		}
		result := tx.Model(&meta.BaiduPhotoMapIndexIntent{}).
			Where("asset_id = ? AND owner_id = ?", assetID, ownerID).
			Updates(map[string]any{
				"primary_node_id": source.nodeID, "node_revision": source.nodeRevision,
				"media_updated_at": source.mediaUpdatedAt, "consent_revision": source.consentRevision,
				"session_version": source.sessionVersion, "status": baiduMapIndexQueued,
				"attempts": 0, "lease_token": "", "lease_until": nil,
				"cancel_requested_at": nil,
			})
		if result.Error != nil || result.RowsAffected != 1 {
			return denied
		}
		return nil
	})
	if err != nil || ctx.Err() != nil {
		return denied
	}
	return nil
}

// claimBaiduPhotoMapIndexIntent is an INTERNAL one-item cross-replica lease.
// A valid consent, original GPS, session and source revision are all read
// again from locked Server state. This is NOT a licence, quota reservation,
// egress authorization, or an actual running conversion task.
func claimBaiduPhotoMapIndexIntent(
	ctx context.Context, db *gorm.DB, ownerID, assetID uint64,
) (baiduMapIndexLease, error) {
	var result baiduMapIndexLease
	denied := errBaiduMapIndexIntentDenied
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 || assetID == 0 {
		return result, denied
	}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		source, err := lockBaiduMapIndexSourceTx(ctx, tx, ownerID, assetID)
		if err != nil {
			return denied
		}
		var row meta.BaiduPhotoMapIndexIntent
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("asset_id = ? AND owner_id = ?", assetID, ownerID).
			Take(&row).Error; err != nil || !baiduMapIndexIntentMatches(row, source) ||
			row.Attempts >= baiduMapIndexMaxClaims {
			return denied
		}
		now, err := baiduMapIndexClockTx(tx)
		if err != nil || (row.Status != baiduMapIndexQueued &&
			(row.Status != baiduMapIndexLeased || row.LeaseUntil == nil ||
				row.LeaseUntil.After(now))) {
			return denied
		}
		token := uuid.NewString()
		until := now.Add(baiduMapIndexLeaseTTL)
		nextAttempt := row.Attempts + 1
		updated := tx.Model(&meta.BaiduPhotoMapIndexIntent{}).
			Where("asset_id = ? AND owner_id = ?", assetID, ownerID).
			Updates(map[string]any{
				"status": baiduMapIndexLeased, "attempts": nextAttempt,
				"lease_token": token, "lease_until": until,
			})
		if updated.Error != nil || updated.RowsAffected != 1 {
			return denied
		}
		result = baiduMapIndexLease{source: source, token: token, until: until, attempt: nextAttempt}
		return nil
	})
	if err != nil || ctx.Err() != nil {
		return baiduMapIndexLease{}, denied
	}
	return result, nil
}

// A separate, pre-dispatch policy check is MANDATORY after claiming (and
// immediately before any eventual external request). A claim alone never
// authorizes egress. A cancelled/replaced/expired lease cannot be reused.
func validateBaiduPhotoMapIndexLease(
	ctx context.Context, db *gorm.DB, lease baiduMapIndexLease,
) error {
	denied := errBaiduMapIndexIntentDenied
	if ctx == nil || ctx.Err() != nil || db == nil ||
		lease.source.ownerID == 0 || lease.source.assetID == 0 ||
		lease.token == "" || lease.attempt == 0 {
		return denied
	}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		source, err := lockBaiduMapIndexSourceTx(ctx, tx, lease.source.ownerID, lease.source.assetID)
		if err != nil || !baiduMapIndexSourcesEqual(source, lease.source) {
			return denied
		}
		var row meta.BaiduPhotoMapIndexIntent
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("asset_id = ? AND owner_id = ?", source.assetID, source.ownerID).
			Take(&row).Error; err != nil || row.Status != baiduMapIndexLeased ||
			!baiduMapIndexIntentMatches(row, source) || row.LeaseToken != lease.token ||
			row.Attempts != lease.attempt || row.LeaseUntil == nil {
			return denied
		}
		now, err := baiduMapIndexClockTx(tx)
		if err != nil || !row.LeaseUntil.After(now) || !lease.until.Equal(*row.LeaseUntil) ||
			ctx.Err() != nil {
			return denied
		}
		return nil
	})
	if err != nil || ctx.Err() != nil {
		return denied
	}
	return nil
}

// Durable Owner-scoped privacy cancellation. A disabled Owner may still
// cancel; no active session or stale GPS is required to revoke queued work.
// The lease token is invalidated atomically so old workers fail validation.
// This is intentionally private until authenticated cancellation transport
// and in-flight context propagation have been independently reviewed.
func cancelBaiduPhotoMapIndexIntent(
	ctx context.Context, db *gorm.DB, ownerID, assetID uint64,
) error {
	denied := errBaiduMapIndexIntentDenied
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 || assetID == 0 {
		return denied
	}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var owner meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", ownerID).Take(&owner).Error; err != nil {
			return denied
		}
		var asset meta.PhotoAsset
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", assetID, owner.ID).
			Take(&asset).Error; err != nil {
			return denied
		}
		var row meta.BaiduPhotoMapIndexIntent
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("asset_id = ? AND owner_id = ?", asset.ID, owner.ID).
			Take(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil // authenticated, idempotent cancellation of absent work
		}
		if err != nil {
			return denied
		}
		if row.Status == baiduMapIndexCancelled {
			return nil
		}
		now, err := baiduMapIndexClockTx(tx)
		if err != nil {
			return denied
		}
		updated := tx.Model(&meta.BaiduPhotoMapIndexIntent{}).
			Where("asset_id = ? AND owner_id = ?", asset.ID, owner.ID).
			Updates(map[string]any{
				"status": baiduMapIndexCancelled, "cancel_requested_at": now,
				"lease_token": "", "lease_until": nil,
			})
		if updated.Error != nil || updated.RowsAffected != 1 {
			return denied
		}
		return nil
	})
	if err != nil || ctx.Err() != nil {
		return denied
	}
	return nil
}
