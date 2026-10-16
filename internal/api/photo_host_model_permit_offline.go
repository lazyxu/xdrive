package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/photointelligence"
)

const offlinePhotoModelPermitTTL = 10 * time.Second

var errOfflinePhotoModelPermitUnavailable = errors.New("offline photo model permit unavailable")

// issueOfflinePhotoModelPermitV1 is a TEST-ONLY bridge from the existing live
// PostgreSQL shared admission session to the candidate MAC codec. There are
// NO production callers, configured signing keys, request headers or host
// control actions. An issued claim cannot yet authorize actual inference.
func (l *photoHostAdmissionLease) issueOfflinePhotoModelPermitV1(
	ctx context.Context,
	keyHex, epoch, serverID, modelID, method, path string,
	body []byte,
	now time.Time,
) (photointelligence.PhotoModelPermitV1, string, error) {
	empty := photointelligence.PhotoModelPermitV1{}
	if l == nil || ctx == nil || ctx.Err() != nil || now.IsZero() {
		return empty, "", errOfflinePhotoModelPermitUnavailable
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.conn == nil || l.key != photoHostAdmissionLockID() {
		return empty, "", errOfflinePhotoModelPermitUnavailable
	}
	bounded, cancel := context.WithTimeout(ctx, photoHostAdmissionHeartbeat)
	defer cancel()

	// Confirm that THIS PostgreSQL session still holds the specific 64-bit
	// shared advisory lock; a fabricated Go lease with a live but unlocked
	// sql.Conn must not mint a permit. PostgreSQL stores the signed 64-bit
	// advisory key as two unsigned 32-bit oid halves, objsubid 1.
	const lockQuery = "SELECT EXISTS(SELECT 1 FROM pg_locks " +
		"WHERE pid = pg_backend_pid() AND locktype = 'advisory' " +
		"AND mode = 'ShareLock' AND granted AND objsubid = 1 " +
		"AND classid::bigint = (($1::bigint >> 32) & 4294967295) " +
		"AND objid::bigint = ($1::bigint & 4294967295))"
	var held bool
	if err := l.conn.QueryRowContext(bounded, lockQuery, l.key).Scan(&held); err != nil || !held {
		return empty, "", errOfflinePhotoModelPermitUnavailable
	}

	var revision int64
	var frozen bool
	// Unlike legacy allowed tasks, a versioned permit needs an EXPLICIT,
	// non-frozen positive revision. Read using the same locked SQL session;
	// never borrow another connection (MaxOpenConns=1 is supported).
	const revisionQuery = "SELECT revision, frozen FROM xd_photo_host_admission_gates WHERE name = $1"
	if err := l.conn.QueryRowContext(bounded, revisionQuery, photoHostAdmissionSettingName).
		Scan(&revision, &frozen); err != nil || frozen || revision <= 0 || revision >= 1<<60 {
		return empty, "", errOfflinePhotoModelPermitUnavailable
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil || bounded.Err() != nil {
		return empty, "", errOfflinePhotoModelPermitUnavailable
	}
	hash := sha256.Sum256(body)
	claim := photointelligence.PhotoModelPermitV1{
		Version:         1,
		DeploymentEpoch: epoch,
		ServerID:        serverID,
		ModelID:         modelID,
		Revision:        revision,
		Nonce:           hex.EncodeToString(nonce[:]),
		IssuedAt:        now.Unix(),
		ExpiresAt:       now.Unix() + int64(offlinePhotoModelPermitTTL/time.Second),
		Method:          method,
		Path:            path,
		BodySHA256:      hex.EncodeToString(hash[:]),
	}
	mac, err := photointelligence.SignPhotoModelPermitV1(keyHex, claim)
	if err != nil || bounded.Err() != nil {
		return empty, "", errOfflinePhotoModelPermitUnavailable
	}
	return claim, mac, nil
}
