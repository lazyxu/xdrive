package baidumapjsapi

import "time"

// AccessAfterRevocation is an additional gate for future Bearer-authenticated
// map-cookie minting. IssuedAt must come from a verified signed access JWT,
// and revokedAfter must be loaded fresh from the shared Server database.
// This never authorizes map runtime on its own.
func AccessAfterRevocation(issuedAt, now time.Time, revokedAfter *time.Time) bool {
	if issuedAt.IsZero() || now.IsZero() || issuedAt.Before(time.Unix(0, 0)) || issuedAt.After(now) {
		return false
	}
	if revokedAfter != nil && !issuedAt.After(*revokedAfter) {
		return false
	}
	return true
}
