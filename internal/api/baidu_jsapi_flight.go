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

var errBaiduJSAPIFlightDenied = errors.New("map resource concurrency unavailable")

const (
	baiduJSAPIOwnerLoaderFlights int64 = 2
	baiduJSAPIFleetLoaderFlights int64 = 16
	baiduJSAPILoaderFlightTTL          = 15 * time.Second
	// An application-wide PostgreSQL transaction advisory lock. NEVER derive
	// the lock key from the caller, schema, Owner ID, or an untrusted URL.
	baiduJSAPILoaderFlightLockKey int64 = 0x5844424d4150464c
)

type baiduJSAPILoaderFlightLimits struct {
	Owner int64
	Fleet int64
}

// baiduJSAPILoaderLease is Server-only and must never cross HTTP/IPC/UI.
// This token is for releasing a DB lease; it does not authorize any map access.
type baiduJSAPILoaderLease struct {
	ownerID int64
	digest  string
}

// acquireBaiduJSAPILoaderFlight is private until licensing, complete observed
// resources, raw AK audits, and authenticated proxy routes are approved. An
// eventual handler MUST hold it from before upstream I/O through response
// completion, defer its release, and bound total work to less than the TTL.
func acquireBaiduJSAPILoaderFlight(ctx context.Context, db *gorm.DB, ownerID uint64) (baiduJSAPILoaderLease, error) {
	return acquireBaiduJSAPILoaderFlightWithLimits(ctx, db, ownerID, baiduJSAPILoaderFlightLimits{
		Owner: baiduJSAPIOwnerLoaderFlights, Fleet: baiduJSAPIFleetLoaderFlights,
	})
}

// Lower caps are only for isolated tests; the production ceilings are fixed.
func acquireBaiduJSAPILoaderFlightWithLimits(ctx context.Context, db *gorm.DB, ownerID uint64, caps baiduJSAPILoaderFlightLimits) (baiduJSAPILoaderLease, error) {
	var zero baiduJSAPILoaderLease
	if ctx == nil || db == nil || ctx.Err() != nil || ownerID == 0 || ownerID > baiduJSAPIQuotaMaxOwnerID ||
		caps.Owner <= 0 || caps.Fleet < caps.Owner || caps.Owner > baiduJSAPIOwnerLoaderFlights ||
		caps.Fleet > baiduJSAPIFleetLoaderFlights {
		return zero, errBaiduJSAPIFlightDenied
	}
	var nonce [32]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return zero, errBaiduJSAPIFlightDenied
	}
	digest := sha256.Sum256(nonce[:])
	lease := baiduJSAPILoaderLease{ownerID: int64(ownerID), digest: hex.EncodeToString(digest[:])}
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// A single transaction-level lock serializes admission across all Server
		// replicas. Reads, expiration pruning and insert happen under this lock.
		var locked any
		if err := tx.Raw("SELECT pg_advisory_xact_lock(?)", baiduJSAPILoaderFlightLockKey).Row().Scan(&locked); err != nil {
			return errBaiduJSAPIFlightDenied
		}
		var now time.Time
		if err := tx.Raw("SELECT clock_timestamp()").Row().Scan(&now); err != nil || now.IsZero() {
			return errBaiduJSAPIFlightDenied
		}
		if err := tx.Where("expires_at <= ?", now).Delete(&meta.BaiduJSAPILoaderFlight{}).Error; err != nil {
			return errBaiduJSAPIFlightDenied
		}
		var fleet, owner int64
		if err := tx.Model(&meta.BaiduJSAPILoaderFlight{}).Count(&fleet).Error; err != nil || fleet >= caps.Fleet {
			return errBaiduJSAPIFlightDenied
		}
		if err := tx.Model(&meta.BaiduJSAPILoaderFlight{}).Where("owner_id = ?", lease.ownerID).Count(&owner).Error; err != nil || owner >= caps.Owner {
			return errBaiduJSAPIFlightDenied
		}
		row := meta.BaiduJSAPILoaderFlight{Digest: lease.digest, OwnerID: lease.ownerID,
			CreatedAt: now, ExpiresAt: now.Add(baiduJSAPILoaderFlightTTL)}
		if err := tx.Create(&row).Error; err != nil {
			return errBaiduJSAPIFlightDenied
		}
		return nil
	}); err != nil {
		return zero, errBaiduJSAPIFlightDenied
	}
	return lease, nil
}

// releaseBaiduJSAPILoaderFlight is idempotent. On a canceled HTTP request,
// the caller must supply a *separate bounded cleanup context*, not that
// request's canceled context. An expired/missing lease never frees another.
func releaseBaiduJSAPILoaderFlight(ctx context.Context, db *gorm.DB, lease baiduJSAPILoaderLease) error {
	if ctx == nil || db == nil || ctx.Err() != nil || lease.ownerID <= 0 ||
		len(lease.digest) != 64 {
		return errBaiduJSAPIFlightDenied
	}
	result := db.WithContext(ctx).Where("digest = ? AND owner_id = ?", lease.digest, lease.ownerID).
		Delete(&meta.BaiduJSAPILoaderFlight{})
	if result.Error != nil || result.RowsAffected > 1 {
		return errBaiduJSAPIFlightDenied
	}
	return nil
}
