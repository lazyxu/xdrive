package source

import "time"

const (
	MirrorMissingRequiredFullScans = 2
	MirrorMissingGrace             = 24 * time.Hour
)

// AdvanceMirrorMissingEvidence advances deletion evidence for one successful,
// complete inventory in which the SourceItem was absent.
//
// The first reliable missing observation starts the grace clock. A future
// clock-skewed timestamp is discarded and restarted at now so Mirror fails
// closed instead of shortening the grace period.
func AdvanceMirrorMissingEvidence(
	currentFullScans int,
	currentSince *time.Time,
	now time.Time,
) (fullScans int, since time.Time, eligible bool) {
	if currentFullScans < 0 {
		currentFullScans = 0
	}
	since = now
	if currentSince != nil && !currentSince.IsZero() && !currentSince.After(now) {
		since = currentSince.UTC()
	}
	fullScans = currentFullScans + 1
	if fullScans > MirrorMissingRequiredFullScans {
		fullScans = MirrorMissingRequiredFullScans
	}
	eligible = fullScans >= MirrorMissingRequiredFullScans &&
		!since.After(now) &&
		now.Sub(since) >= MirrorMissingGrace
	return fullScans, since, eligible
}
