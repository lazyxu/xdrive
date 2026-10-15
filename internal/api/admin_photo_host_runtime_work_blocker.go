package api

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

const photoHostRuntimeWorkProbeTimeout = 800 * time.Millisecond

// Mirror the fixed kinds submitted by photo_intelligence_scheduler.go.
// This checks already-published scheduler presence on any Server replica,
// including this one. It cannot certify cluster membership or safe draining.
var photoHostRuntimeWorkKinds = []string{
	"photo.face",
	"photo.smart_search",
	"photo.semantic_search",
	"photo.place",
	"photo.person_cluster",
}

// Negative-only observation of current/fresh background task presence.
// The existing 2-second runtime publisher uses a 10-second expiration.
// A stale or missing heartbeat can NEVER be interpreted as a clear fleet.
func (s *Server) photoHostRuntimeWorkBlocker(ctx context.Context) string {
	if s == nil || s.DB == nil || ctx == nil || ctx.Err() != nil {
		return "unverified"
	}
	probeCtx, cancel := context.WithTimeout(ctx, photoHostRuntimeWorkProbeTimeout)
	defer cancel()

	var found int
	result := s.DB.WithContext(probeCtx).
		Table(meta.BackgroundRuntimePresence{}.TableName()).
		Select("1").
		Where("kind IN ?", photoHostRuntimeWorkKinds).
		Where("expires_at > ?", time.Now().UTC()).
		Where(
			"(state IN ? OR active_count > 0 OR queued_count > 0 OR running_count > 0)",
			[]string{"queued", "running", "cancelling", "cancel_requested"},
		).
		Limit(1).
		Scan(&found)
	if result.Error != nil || probeCtx.Err() != nil {
		return "unverified"
	}
	if result.RowsAffected > 0 {
		return "blocked"
	}
	// Not 'idle': task presence expiry, publisher outage, newly queued work,
	// or a Server without runtime publisher still prevent a global stop proof.
	return "unverified"
}
