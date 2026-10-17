package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

var errBaiduGeoconvFlightDenied = errors.New("baidu coordinate index capacity unavailable")

const (
	baiduGeoconvOwnerFlightCap int64 = 1
	baiduGeoconvFleetFlightCap int64 = 2
	baiduGeoconvFlightTTL            = 15 * time.Second
	// Fixed service-wide PostgreSQL transaction lock; never derived from a
	// caller, URL, Owner ID or application schema. Separate from JSAPI Loader.
	baiduGeoconvFlightLockKey int64 = 0x584447434f4e5646
)

type baiduGeoconvFlightLimits struct {
	Owner int64
	Fleet int64
}

// baiduGeoconvFlightLease is only a capacity release receipt, NOT approval
// to export location or proof of a Baidu licence. Never send via REST/IPC.
type baiduGeoconvFlightLease struct {
	ownerID int64
	digest  string
}

func acquireBaiduGeoconvFlight(ctx context.Context, db *gorm.DB, ownerID uint64) (baiduGeoconvFlightLease, error) {
	return acquireBaiduGeoconvFlightWithLimits(ctx, db, ownerID, baiduGeoconvFlightLimits{
		Owner: baiduGeoconvOwnerFlightCap,
		Fleet: baiduGeoconvFleetFlightCap,
	})
}

// Test-only lower limits cannot raise the code-reviewed production caps.
// This is NOT a dispatch entitlement. Caller checks trusted licence FIRST.
// A single DB advisory transaction lock serializes fleet/Owner counts,
// expiration pruning, and insertion across all Server processes.
func acquireBaiduGeoconvFlightWithLimits(
	ctx context.Context, db *gorm.DB, ownerID uint64, caps baiduGeoconvFlightLimits,
) (baiduGeoconvFlightLease, error) {
	var zero baiduGeoconvFlightLease
	denied := errBaiduGeoconvFlightDenied
	if ctx == nil || ctx.Err() != nil || db == nil ||
		ownerID == 0 || ownerID > baiduGeoconvQuotaMaxOwnerID ||
		caps.Owner <= 0 || caps.Owner > baiduGeoconvOwnerFlightCap ||
		caps.Fleet < caps.Owner || caps.Fleet > baiduGeoconvFleetFlightCap {
		return zero, denied
	}
	var nonce [32]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return zero, denied
	}
	digest := sha256.Sum256(nonce[:])
	lease := baiduGeoconvFlightLease{
		ownerID: int64(ownerID),
		digest:  hex.EncodeToString(digest[:]),
	}
	clear(nonce[:])
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lock any
		if err := tx.Raw("SELECT pg_advisory_xact_lock(?)", baiduGeoconvFlightLockKey).
			Row().Scan(&lock); err != nil {
			return denied
		}
		var now time.Time
		if err := tx.Raw("SELECT clock_timestamp()").Row().Scan(&now); err != nil || now.IsZero() {
			return denied
		}
		if err := tx.Where("expires_at <= ?", now).
			Delete(&meta.BaiduGeoconvFlight{}).Error; err != nil {
			return denied
		}
		var fleet, owner int64
		if err := tx.Model(&meta.BaiduGeoconvFlight{}).Count(&fleet).Error; err != nil ||
			fleet >= caps.Fleet {
			return denied
		}
		if err := tx.Model(&meta.BaiduGeoconvFlight{}).
			Where("owner_id = ?", lease.ownerID).Count(&owner).Error; err != nil ||
			owner >= caps.Owner {
			return denied
		}
		return tx.Create(&meta.BaiduGeoconvFlight{
			Digest: lease.digest, OwnerID: lease.ownerID,
			CreatedAt: now, ExpiresAt: now.Add(baiduGeoconvFlightTTL),
		}).Error
	})
	if err != nil {
		return zero, denied
	}
	// If cancellation arrives between the DB commit and this return, recover
	// our own row with an independent short context. A failed cleanup cannot
	// free another Owner's lease and otherwise expires by PostgreSQL clock.
	if ctx.Err() != nil {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = releaseBaiduGeoconvFlight(cleanupCtx, db, lease)
		cancel()
		return zero, denied
	}
	return lease, nil
}

// The future actual HTTPS request MUST use the already bounded, cancellable
// <= 8-second trusted execution Context; no work may outlast the 15s lease.
// On any return, clean up with an independent bounded Context even if the
// original request was canceled. Wrong-owner and stale releases are harmless.
func releaseBaiduGeoconvFlight(ctx context.Context, db *gorm.DB, lease baiduGeoconvFlightLease) error {
	if ctx == nil || ctx.Err() != nil || db == nil || lease.ownerID <= 0 ||
		len(lease.digest) != 64 {
		return errBaiduGeoconvFlightDenied
	}
	if _, err := hex.DecodeString(lease.digest); err != nil {
		return errBaiduGeoconvFlightDenied
	}
	result := db.WithContext(ctx).
		Where("digest = ? AND owner_id = ?", lease.digest, lease.ownerID).
		Delete(&meta.BaiduGeoconvFlight{})
	if result.Error != nil || result.RowsAffected > 1 {
		return errBaiduGeoconvFlightDenied
	}
	return nil
}
