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
	baiduMapIndexFailed    = "failed"
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

// Index queue lock order: Owner -> PhotoAsset -> Node -> MediaMetadata -> intent.
// Account/session changes, source edits and cancellation still fail closed.
// An additional per-photo map consent is never required.
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
		Take(&asset).Error; err != nil {
		return none, errBaiduMapIndexIntentDenied
	}
	// A Live Photo, RAW pair or burst has one logical Owner PhotoAsset and
	// one primary indexed image/video location. Do not require a plain
	// image kind or issue a second map authorization for grouped media.
	switch asset.Kind {
	case meta.PhotoAssetKindImage, meta.PhotoAssetKindVideo,
		meta.PhotoAssetKindLivePhoto, meta.PhotoAssetKindRAWPair, meta.PhotoAssetKindBurst:
	default:
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
	// The Owner's current indexed GPS is sufficient. No per-photo grant.
	return baiduMapIndexSource{
		ownerID: owner.ID, assetID: asset.ID, nodeID: node.ID,
		nodeRevision: node.Revision, sessionVersion: owner.SessionVersion,
		mediaUpdatedAt: media.UpdatedAt, consentRevision: 0,
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

// A historical per-photo consent revision is no longer authorization, but an
// explicit terminal cancellation still belongs to its original Owner/source
// generation. Do not resurrect it merely because the obsolete consent_revision
// differs from today's zero value.
func baiduMapIndexSameOwnerSourceGeneration(row meta.BaiduPhotoMapIndexIntent, source baiduMapIndexSource) bool {
	return row.AssetID == source.assetID && row.OwnerID == source.ownerID &&
		row.PrimaryNodeID == source.nodeID && row.NodeRevision == source.nodeRevision &&
		row.MediaUpdatedAt.Equal(source.mediaUpdatedAt) &&
		row.SessionVersion == source.sessionVersion
}

// PostgreSQL-clock cooldown: no manual photo authorization or repeated
// provider requests during the 24h failure window. A future retry_after
// remains authoritative even after that window.
func baiduPhotoMapFailedRetryDue(now, updated time.Time, retryAfter *time.Time) bool {
	return !now.IsZero() && !updated.IsZero() &&
		!updated.Add(baiduPhotoMapAutoFailedRetryCooldown).After(now) &&
		(retryAfter == nil || !retryAfter.After(now))
}

// enqueueBaiduPhotoMapIndexIntent persists bounded Owner/source-fenced work.
// expectedRevision is a deprecated compatibility parameter, ignored. No
// per-photo opt-in is needed, and this method never sends raw GPS or AK.
func enqueueBaiduPhotoMapIndexIntent(
	ctx context.Context, db *gorm.DB, ownerID, assetID, expectedRevision uint64,
) error {
	denied := errBaiduMapIndexIntentDenied
	if ctx == nil || ctx.Err() != nil || db == nil ||
		ownerID == 0 || assetID == 0 {
		return denied
	}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		source, err := lockBaiduMapIndexSourceTx(ctx, tx, ownerID, assetID)
		if err != nil {
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
		if baiduMapIndexSameOwnerSourceGeneration(old, source) {
			// Only a current zero-revision task cancellation persists. A
			// cancelled consent-era generation is a retired authorization
			// decision; it cannot block today's otherwise valid Owner GPS.
			if old.Status == baiduMapIndexCancelled &&
				old.ConsentRevision == source.consentRevision {
				return denied
			}
			// Legacy consent revisions are not a cooldown bypass either.
			if old.Status == baiduMapIndexFailed &&
				old.ConsentRevision != source.consentRevision {
				now, clockErr := baiduMapIndexClockTx(tx)
				if clockErr != nil || !baiduPhotoMapFailedRetryDue(now, old.UpdatedAt, old.RetryAfter) {
					return denied
				}
			}
		}
		if baiduMapIndexIntentMatches(old, source) {
			if old.Status == baiduMapIndexQueued || old.Status == baiduMapIndexLeased {
				return nil // idempotent: never create a second claimable job
			}
			if old.Status == baiduMapIndexFailed {
				// Exhaustion is not permanent now that the photo-specific retry
				// endpoint has been retired. Only the DB clock can release it.
				now, clockErr := baiduMapIndexClockTx(tx)
				if clockErr != nil || !baiduPhotoMapFailedRetryDue(now, old.UpdatedAt, old.RetryAfter) {
					return denied
				}
			} else if old.Status != baiduMapIndexCompleted {
				return denied // cancelled Owner work remains cancelled
			}
			// A completed receipt whose derived row has disappeared can be
			// planned again. Verify absence under the same Owner/source locks,
			// so an existing valid BD09 point is never unnecessarily replaced.
			var existing int64
			if err := tx.Model(&meta.BaiduPhotoMapPosition{}).
				Where("asset_id = ? AND owner_id = ? AND primary_node_id = ? AND node_revision = ? AND media_updated_at = ?",
					source.assetID, source.ownerID, source.nodeID, source.nodeRevision, source.mediaUpdatedAt).
				Where("source_latitude = ? AND source_longitude = ? AND coordinate_space = ? AND projection_version = ?",
					source.latitude, source.longitude, meta.BaiduPhotoMapSpaceBD09LL,
					meta.BaiduPhotoMapProjectionGeoconvV2).
				Where("latitude BETWEEN -85 AND 85 AND longitude BETWEEN -180 AND 180").
				Count(&existing).Error; err != nil {
				return denied
			}
			if existing != 0 {
				return nil // concurrent completion already restored the point
			}
		}
		if old.Status == baiduMapIndexLeased {
			// During migration an old consent-bound job may still have an
			// in-flight lease. Never steal it. Only a PostgreSQL-expired lease
			// can be replaced by the new current Owner/source generation.
			now, err := baiduMapIndexClockTx(tx)
			if err != nil || old.LeaseUntil == nil || old.LeaseUntil.After(now) {
				return denied
			}
		}
		result := tx.Model(&meta.BaiduPhotoMapIndexIntent{}).
			Where("asset_id = ? AND owner_id = ?", assetID, ownerID).
			Updates(map[string]any{
				"primary_node_id": source.nodeID, "node_revision": source.nodeRevision,
				"media_updated_at": source.mediaUpdatedAt, "consent_revision": source.consentRevision,
				"session_version": source.sessionVersion, "status": baiduMapIndexQueued,
				"attempts": 0, "lease_token": "", "lease_until": nil,
				"retry_after": nil, "cancel_requested_at": nil,
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
// A valid original GPS, live Owner/session and source revision are read
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
			Take(&row).Error; err != nil || !baiduMapIndexIntentMatches(row, source) {
			return denied
		}
		now, err := baiduMapIndexClockTx(tx)
		if err != nil {
			return denied
		}
		// A crashed Server's expired lease is ONLY repaired on this explicit
		// Owner+Asset demand. Never immediately redispatch it or bypass the
		// PostgreSQL-clock retry delay. Old lease tokens become invalid now.
		if row.Status == baiduMapIndexLeased {
			if row.LeaseUntil == nil || row.LeaseUntil.After(now) ||
				row.Attempts == 0 || row.Attempts > baiduMapIndexMaxClaims {
				return denied
			}
			status, retryAfter := baiduMapIndexNextRetry(row.Attempts, now)
			repair := tx.Model(&meta.BaiduPhotoMapIndexIntent{}).
				Where("owner_id = ? AND asset_id = ? AND status = ? AND lease_token = ? AND attempts = ?",
					ownerID, assetID, baiduMapIndexLeased, row.LeaseToken, row.Attempts).
				Updates(map[string]any{
					"status": status, "retry_after": retryAfter,
					"lease_token": "", "lease_until": nil,
				})
			if repair.Error != nil || repair.RowsAffected != 1 {
				return denied
			}
			return nil // durable repair only, not a new claim/AK read
		}
		if row.Status != baiduMapIndexQueued ||
			row.Attempts >= baiduMapIndexMaxClaims ||
			(row.RetryAfter != nil && row.RetryAfter.After(now)) {
			return denied
		}
		token := uuid.NewString()
		until := now.Add(baiduMapIndexLeaseTTL)
		nextAttempt := row.Attempts + 1
		updated := tx.Model(&meta.BaiduPhotoMapIndexIntent{}).
			Where("asset_id = ? AND owner_id = ?", assetID, ownerID).
			Updates(map[string]any{
				"status": baiduMapIndexLeased, "attempts": nextAttempt,
				"lease_token": token, "lease_until": until, "retry_after": nil,
			})
		if updated.Error != nil || updated.RowsAffected != 1 {
			return denied
		}
		result = baiduMapIndexLease{source: source, token: token, until: until, attempt: nextAttempt}
		return nil
	})
	if err != nil || ctx.Err() != nil || result.token == "" {
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
		// A completed receipt is terminal. Cancelling old work must not
		// retroactively erase a successfully committed position; the Owner's
		// separate consent revocation path purges derived data atomically.
		if row.Status == baiduMapIndexCancelled || row.Status == baiduMapIndexCompleted ||
			row.Status == baiduMapIndexFailed {
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
				"lease_token": "", "lease_until": nil, "retry_after": nil,
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
