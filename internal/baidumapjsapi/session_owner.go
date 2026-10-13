package baidumapjsapi

import (
	"encoding/base64"
	"encoding/binary"
	"time"
)

// InspectMapSessionOwner authenticates the opaque map-only Cookie and extracts
// only its OwnerID. This is an identification hint, NOT authorization. The
// caller must fetch the current user, key revision and revocation epoch from
// the Server database, then call VerifyMapSession with that fresh state on
// every resource request. Never return OwnerID to a browser or access logs.
func InspectMapSessionOwner(secret []byte, value string, now time.Time) (uint64, error) {
	if now.IsZero() || len(value) < 24 || len(value) > mapCookieMaxBytes {
		return 0, ErrMapSessionDenied
	}
	gcm, err := mapCipher(secret)
	if err != nil {
		return 0, ErrMapSessionDenied
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(raw) != gcm.NonceSize()+mapSessionPayloadBytes+gcm.Overhead() {
		return 0, ErrMapSessionDenied
	}
	payload, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], mapAAD)
	if err != nil || len(payload) != mapSessionPayloadBytes || payload[0] != mapSessionFormat {
		return 0, ErrMapSessionDenied
	}
	defer clear(payload)
	owner := binary.BigEndian.Uint64(payload[1:9])
	sessionVersion := binary.BigEndian.Uint64(payload[9:17])
	configRevision := binary.BigEndian.Uint64(payload[17:25])
	epoch := binary.BigEndian.Uint64(payload[25:33])
	issued := int64(binary.BigEndian.Uint64(payload[33:41]))
	expires := int64(binary.BigEndian.Uint64(payload[41:49]))
	if owner == 0 || sessionVersion == 0 || configRevision == 0 || epoch == 0 || issued <= 0 || expires <= issued || expires-issued > int64(MapMaxSessionTTL) || now.UnixNano() < issued || now.UnixNano() >= expires {
		return 0, ErrMapSessionDenied
	}
	return owner, nil
}
