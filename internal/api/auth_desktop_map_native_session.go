package api

import (
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// desktopMapNativeSessionActive follows ONLY Server-recorded refresh
// replacements of the original native Agent token. A revoked terminal token
// is a logout; its expiry or a foreign owner must never authorize a browser
// refresh or a Desktop-map-derived Access JWT.
//
// A finite chain limit and cycle fence fail closed on corrupt/stale data.
// In the browser refresh transaction, lock=true serializes this check with
// native refresh/logout mutations; per-request access checks use read-only DB.
func desktopMapNativeSessionActive(
	db *gorm.DB, ownerID, refreshID uint64, now time.Time, lock bool,
) bool {
	if db == nil || ownerID == 0 || refreshID == 0 {
		return false
	}
	seen := map[uint64]struct{}{}
	for hop := 0; hop < 32; hop++ {
		if _, duplicate := seen[refreshID]; duplicate {
			return false
		}
		seen[refreshID] = struct{}{}
		query := db
		if lock {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		var record meta.RefreshToken
		if err := query.Where("id = ? AND user_id = ?", refreshID, ownerID).
			Take(&record).Error; err != nil {
			return false
		}
		if record.RevokedAt == nil {
			// Only the current active native credential needs an unexpired
			// TTL. After a legitimate atomic refresh, a revoked predecessor
			// can expire while its Server-recorded successor is still live.
			return now.Before(record.ExpiresAt)
		}
		if record.ReplacedByID == nil || *record.ReplacedByID == 0 {
			// A terminal revocation is logout, not a rotated session.
			return false
		}
		refreshID = *record.ReplacedByID
	}
	return false
}
