package api

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errLocalPushFirstDirectoryChallengeDenied = errors.New("private first-directory challenge unavailable")

// Use the PostgreSQL clock both when creating and consuming a private ticket.
// A caller-controlled time, browser clock or delayed Agent clock is not
// authoritative for expiry. The native HMAC validator receives THIS clock.
func localPushFirstDirectoryDBClock(tx *gorm.DB) (time.Time, error) {
	if tx == nil {
		return time.Time{}, errLocalPushFirstDirectoryChallengeDenied
	}
	var now time.Time
	if err := tx.Raw("SELECT clock_timestamp()").Row().Scan(&now); err != nil || now.IsZero() {
		return time.Time{}, errLocalPushFirstDirectoryChallengeDenied
	}
	return now.UTC(), nil
}

func localPushFirstDirectoryNonceDigest(nonce [32]byte) string {
	sum := sha256.Sum256(nonce[:])
	return hex.EncodeToString(sum[:])
}

func privateFirstDirectoryChallengeMatches(
	row meta.LocalPushFirstDirectoryChallenge,
	challenge localpush.LocalFirstDirectoryAdvisoryChallenge,
	ownerSession uint64,
) bool {
	if row.SourceID != challenge.SourceID || row.OwnerID != challenge.OwnerID ||
		row.SourceRevision != challenge.SourceRevision ||
		row.TargetNodeID != challenge.TargetNodeID ||
		row.OwnerSession == 0 || row.OwnerSession != ownerSession ||
		row.DeviceID != challenge.DeviceID || row.RootID != challenge.RootID ||
		row.RootFingerprint != challenge.RootFingerprint ||
		!row.IssuedAt.Equal(challenge.IssuedAt) ||
		!row.ExpiresAt.Equal(challenge.ExpiresAt) ||
		len(row.NonceSHA256) != 64 {
		return false
	}
	digest := localPushFirstDirectoryNonceDigest(challenge.Nonce)
	return subtle.ConstantTimeCompare([]byte(row.NonceSHA256), []byte(digest)) == 1
}

// issueBoundLocalPushFirstDirectoryChallenge is PRIVATE Server code. Neither
// REST, Agent IPC, Desktop nor a production scheduler calls this. It records
// one unguessable challenge digest, NOT an upload grant. The caller must
// already have a verified Gin owning-device proof; this routine RECHECKS it
// under PostgreSQL locks before issuing a non-JSON private value.
func (s *Server) issueBoundLocalPushFirstDirectoryChallenge(
	c *gin.Context, sourceID, revision uint64,
) (localpush.LocalFirstDirectoryAdvisoryChallenge, error) {
	var empty localpush.LocalFirstDirectoryAdvisoryChallenge
	denied := errLocalPushFirstDirectoryChallengeDenied
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		sourceID == 0 || revision == 0 || c.Request.Context().Err() != nil {
		return empty, denied
	}
	proof, ok := localPushStageProof(c)
	if !ok || proof.SourceRevision != revision {
		return empty, denied
	}
	var issued localpush.LocalFirstDirectoryAdvisoryChallenge
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Common order with the existing staged CAS path: Owner SHARE ->
		// Device UPDATE -> Source UPDATE -> Root SHARE -> target -> challenge.
		var owner meta.User
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND disabled_at IS NULL AND session_version > 0", userID(c)).
			Take(&owner).Error; err != nil {
			return denied
		}
		source, err := s.checkLocalPushStageScopeTx(tx, c, sourceID, revision, proof)
		if err != nil || source.TargetNodeID == nil {
			return denied
		}
		var binding meta.LocalSourceBinding
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("source_id = ? AND owner_id = ? AND device_id = ?", sourceID, owner.ID, proof.DeviceID).
			Take(&binding).Error; err != nil || binding.RootID != proof.RootID ||
			binding.RootFingerprint != strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint"))) {
			return denied
		}
		now, err := localPushFirstDirectoryDBClock(tx)
		if err != nil {
			return denied
		}
		var current meta.LocalPushFirstDirectoryChallenge
		lookupErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id = ?", sourceID).Take(&current).Error
		if lookupErr != nil && !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return denied
		}
		// Do not silently rotate an in-flight, still valid challenge. Reissue
		// only on an explicit subsequent call after expiration/consumption.
		if lookupErr == nil && current.State == meta.LocalPushFirstDirectoryChallengeIssued &&
			current.ExpiresAt.After(now) {
			return denied
		}
		challenge, err := localpush.NewLocalFirstDirectoryAdvisoryChallenge(
			owner.ID, sourceID, revision, *source.TargetNodeID,
			proof.DeviceID, proof.RootID, binding.RootFingerprint, now,
		)
		if err != nil || c.Request.Context().Err() != nil {
			return denied
		}
		row := meta.LocalPushFirstDirectoryChallenge{
			SourceID: sourceID, OwnerID: owner.ID, OwnerSession: owner.SessionVersion,
			SourceRevision: revision, TargetNodeID: *source.TargetNodeID,
			DeviceID: proof.DeviceID, RootID: proof.RootID,
			RootFingerprint: binding.RootFingerprint,
			NonceSHA256:     localPushFirstDirectoryNonceDigest(challenge.Nonce),
			State:           meta.LocalPushFirstDirectoryChallengeIssued,
			IssuedAt:        challenge.IssuedAt, ExpiresAt: challenge.ExpiresAt,
		}
		if errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			if err := tx.Create(&row).Error; err != nil {
				return denied
			}
		} else {
			updated := tx.Model(&meta.LocalPushFirstDirectoryChallenge{}).
				Where("source_id = ? AND state = ? AND nonce_sha256 = ?", sourceID, current.State, current.NonceSHA256).
				Updates(map[string]any{
					"owner_id": row.OwnerID, "owner_session": row.OwnerSession,
					"source_revision": row.SourceRevision, "target_node_id": row.TargetNodeID,
					"device_id": row.DeviceID, "root_id": row.RootID,
					"root_fingerprint": row.RootFingerprint,
					"nonce_sha256":     row.NonceSHA256,
					"state":            row.State, "issued_at": row.IssuedAt,
					"expires_at": row.ExpiresAt, "consumed_at": nil,
				})
			if updated.Error != nil || updated.RowsAffected != 1 {
				return denied
			}
		}
		issued = challenge
		return c.Request.Context().Err()
	})
	if err != nil || c.Request.Context().Err() != nil {
		return empty, denied
	}
	return issued, nil
}

// consumeBoundLocalPushFirstDirectoryChallenge atomically burns exactly one
// Server-recorded challenge after repeating Owner/Device/Root/Source/target
// checks and verifying the MAC. A TRUE return means only that one advisory
// challenge was consumed. It is NEVER authority to call a SQL/CAS writer:
// there is no native inode lifetime lock or SourceRun in this transaction.
func (s *Server) consumeBoundLocalPushFirstDirectoryChallenge(
	c *gin.Context,
	challenge localpush.LocalFirstDirectoryAdvisoryChallenge,
	seal localpush.LocalFirstDirectoryAdvisorySeal,
) (bool, error) {
	denied := errLocalPushFirstDirectoryChallengeDenied
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		challenge.OwnerID == 0 || challenge.SourceID == 0 ||
		challenge.SourceRevision == 0 || c.Request.Context().Err() != nil {
		return false, denied
	}
	proof, ok := localPushStageProof(c)
	if !ok || proof.SourceRevision != challenge.SourceRevision ||
		proof.DeviceID != challenge.DeviceID || proof.RootID != challenge.RootID ||
		challenge.OwnerID != userID(c) {
		return false, denied
	}
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var owner meta.User
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND disabled_at IS NULL AND session_version > 0", challenge.OwnerID).
			Take(&owner).Error; err != nil {
			return denied
		}
		source, err := s.checkLocalPushStageScopeTx(tx, c, challenge.SourceID, challenge.SourceRevision, proof)
		if err != nil || source.TargetNodeID == nil ||
			*source.TargetNodeID != challenge.TargetNodeID {
			return denied
		}
		var binding meta.LocalSourceBinding
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("source_id = ? AND owner_id = ? AND device_id = ?", challenge.SourceID, owner.ID, proof.DeviceID).
			Take(&binding).Error; err != nil || binding.RootID != proof.RootID ||
			binding.RootFingerprint != challenge.RootFingerprint {
			return denied
		}
		var row meta.LocalPushFirstDirectoryChallenge
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id = ? AND owner_id = ?", challenge.SourceID, owner.ID).
			Take(&row).Error; err != nil ||
			row.State != meta.LocalPushFirstDirectoryChallengeIssued ||
			row.ConsumedAt != nil ||
			!privateFirstDirectoryChallengeMatches(row, challenge, owner.SessionVersion) {
			return denied
		}
		now, err := localPushFirstDirectoryDBClock(tx)
		if err != nil || now.Before(row.IssuedAt) || !now.Before(row.ExpiresAt) ||
			!localpush.VerifyLocalFirstDirectoryAdvisoryObservation(
				c.Request.Context(), seal, challenge,
				c.GetHeader("X-XDrive-Device-Token"), now,
			) {
			return denied
		}
		updated := tx.Model(&meta.LocalPushFirstDirectoryChallenge{}).
			Where("source_id = ? AND owner_id = ? AND state = ? AND nonce_sha256 = ? AND consumed_at IS NULL",
				challenge.SourceID, owner.ID, meta.LocalPushFirstDirectoryChallengeIssued, row.NonceSHA256).
			Updates(map[string]any{
				"state":       meta.LocalPushFirstDirectoryChallengeConsumed,
				"consumed_at": now,
			})
		if updated.Error != nil || updated.RowsAffected != 1 {
			return denied
		}
		return c.Request.Context().Err()
	})
	if err != nil || c.Request.Context().Err() != nil {
		return false, denied
	}
	return true, nil
}
