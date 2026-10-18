package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const localPushOperationIntentTTL = 30 * time.Second

var errLocalPushOperationIntentDenied = errors.New("private local operation unavailable")

const localPushOperationRequestKeySize = 32
const localPushOperationRequestKeyDomain = "xdrive-localpush-operation-request-v1\x00"

// Only a digest of the future native Agent's high-entropy request identifier
// is stored. This digest is NOT an authorization secret or proof of native
// bytes. There is intentionally no production transport or runtime caller.
func localPushOperationRequestKeyDigest(key []byte) (string, bool) {
	if len(key) != localPushOperationRequestKeySize {
		return "", false
	}
	var nonzero byte
	for _, b := range key {
		nonzero |= b
	}
	if nonzero == 0 {
		return "", false
	}
	b := make([]byte, 0, len(localPushOperationRequestKeyDomain)+len(key))
	b = append(b, localPushOperationRequestKeyDomain...)
	b = append(b, key...)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), true
}

// localPushOperationIntentScopeTx must be invoked inside the caller's SQL
// transaction. It follows Owner SHARE -> Device UPDATE -> Source UPDATE ->
// Root SHARE, the same order used by existing staged writes and revocation.
// This is admission only: a paused Source cannot begin a real SourceRun.
func (s *Server) localPushOperationIntentScopeTx(
	tx *gorm.DB, c *gin.Context, sourceID, revision uint64,
	proof localSourceExecutorProof,
) (meta.User, meta.Source, string, error) {
	var owner meta.User
	var empty meta.Source
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND disabled_at IS NULL AND session_version > 0", userID(c)).
		Take(&owner).Error; err != nil {
		return meta.User{}, empty, "", errLocalPushOperationIntentDenied
	}
	source, err := s.checkLocalPushStageScopeTx(tx, c, sourceID, revision, proof)
	if err != nil || source.TargetNodeID == nil {
		return meta.User{}, empty, "", errLocalPushOperationIntentDenied
	}
	var binding meta.LocalSourceBinding
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("source_id = ? AND owner_id = ? AND device_id = ?", sourceID, owner.ID, proof.DeviceID).
		Take(&binding).Error; err != nil || binding.RootID != proof.RootID {
		return meta.User{}, empty, "", errLocalPushOperationIntentDenied
	}
	fingerprint := strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint")))
	if binding.RootFingerprint != fingerprint || len(fingerprint) != 64 {
		return meta.User{}, empty, "", errLocalPushOperationIntentDenied
	}
	return owner, source, fingerprint, nil
}

// reserveBoundLocalPushOperationIntent is PRIVATE and deliberately UNROUTED.
// Its only effect is to store a non-authoritative, expiring reservation. It
// cannot grant native-handle lifetime, Stage/CAS/SQL write, SourceRun or UI
// authority. No background producer or production caller invokes it.
func (s *Server) reserveBoundLocalPushOperationIntent(
	c *gin.Context, sourceID, revision uint64,
) (meta.LocalPushOperationIntent, error) {
	return s.reserveBoundLocalPushOperationIntentInternal(c, sourceID, revision, nil)
}

// reserveBoundLocalPushOperationIntentWithKey is Server-private and unrouted.
// The 32-byte key must come from a future separately authenticated native
// session. Exact live retry returns the original row, never new work.
func (s *Server) reserveBoundLocalPushOperationIntentWithKey(
	c *gin.Context, sourceID, revision uint64, requestKey []byte,
) (meta.LocalPushOperationIntent, error) {
	digest, ok := localPushOperationRequestKeyDigest(requestKey)
	if !ok {
		return meta.LocalPushOperationIntent{}, errLocalPushOperationIntentDenied
	}
	return s.reserveBoundLocalPushOperationIntentInternal(c, sourceID, revision, &digest)
}

// A nil digest is the legacy internal reservation path, not a shortcut for
// keyed admission. All admission paths share exactly the same locked scope.
func (s *Server) reserveBoundLocalPushOperationIntentInternal(
	c *gin.Context, sourceID, revision uint64, requestKeyDigest *string,
) (meta.LocalPushOperationIntent, error) {
	var empty meta.LocalPushOperationIntent
	denied := errLocalPushOperationIntentDenied
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		sourceID == 0 || revision == 0 || c.Request.Context().Err() != nil {
		return empty, denied
	}
	proof, ok := localPushStageProof(c)
	if !ok || proof.SourceRevision != revision {
		return empty, denied
	}
	var created meta.LocalPushOperationIntent
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		owner, source, fingerprint, err := s.localPushOperationIntentScopeTx(tx, c, sourceID, revision, proof)
		if err != nil {
			return denied
		}
		now, err := localPushFirstDirectoryDBClock(tx)
		if err != nil {
			return denied
		}
		var last meta.LocalPushOperationIntent
		lookup := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id = ?", sourceID).Order("generation DESC").Take(&last).Error
		if lookup != nil && !errors.Is(lookup, gorm.ErrRecordNotFound) {
			return denied
		}
		if requestKeyDigest != nil {
			var prior meta.LocalPushOperationIntent
			keyLookup := tx.Where("source_id = ? AND request_key_digest = ?", sourceID, *requestKeyDigest).
				Take(&prior).Error
			if keyLookup == nil {
				// Stale/expired/aborted idempotency keys can NEVER create a
				// fresh generation, even if the current scope was reauthorized.
				if lookup != nil || prior.ID != last.ID || prior.Generation != last.Generation ||
					prior.RequestKeyDigest == nil || *prior.RequestKeyDigest != *requestKeyDigest ||
					prior.OwnerID != owner.ID || prior.OwnerSession != owner.SessionVersion ||
					prior.DeviceID != proof.DeviceID || prior.RootID != proof.RootID ||
					prior.RootFingerprint != fingerprint || prior.SourceRevision != source.Revision ||
					source.TargetNodeID == nil || prior.TargetNodeID != *source.TargetNodeID ||
					prior.State != meta.LocalPushOperationIntentReserved || prior.AbortedAt != nil ||
					prior.IssuedAt.IsZero() || !prior.ExpiresAt.After(prior.IssuedAt) ||
					now.Before(prior.IssuedAt) || !now.Before(prior.ExpiresAt) {
					return denied
				}
				created = prior
				return c.Request.Context().Err()
			}
			if !errors.Is(keyLookup, gorm.ErrRecordNotFound) {
				return denied
			}
		}
		generation := uint64(1)
		if lookup == nil {
			if last.Generation == 0 || last.Generation == math.MaxUint64 ||
				(last.State == meta.LocalPushOperationIntentReserved && now.Before(last.ExpiresAt)) {
				return denied
			}
			generation = last.Generation + 1
		}
		id, err := uuid.NewRandom()
		if err != nil || source.TargetNodeID == nil {
			return denied
		}
		created = meta.LocalPushOperationIntent{
			ID: id.String(), SourceID: sourceID, Generation: generation,
			OwnerID: owner.ID, OwnerSession: owner.SessionVersion,
			SourceRevision: source.Revision, TargetNodeID: *source.TargetNodeID,
			DeviceID: proof.DeviceID, RootID: proof.RootID, RootFingerprint: fingerprint,
			RequestKeyDigest: requestKeyDigest,
			State:            meta.LocalPushOperationIntentReserved,
			IssuedAt:         now, ExpiresAt: now.Add(localPushOperationIntentTTL),
		}
		if err := tx.Create(&created).Error; err != nil {
			return denied
		}
		return c.Request.Context().Err()
	})
	if err != nil || c.Request.Context().Err() != nil {
		return empty, denied
	}
	return created, nil
}

// abortBoundLocalPushOperationIntent records a strict same-generation,
// same-owner/device/Root abort. It is NOT a remote cancellation endpoint and
// does not imply that any durable transfer or SourceRun was canceled.
func (s *Server) abortBoundLocalPushOperationIntent(
	c *gin.Context, sourceID, revision uint64, operationID string, generation uint64,
) error {
	denied := errLocalPushOperationIntentDenied
	parsed, parseErr := uuid.Parse(operationID)
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		sourceID == 0 || revision == 0 || generation == 0 ||
		parseErr != nil || parsed.String() != operationID || c.Request.Context().Err() != nil {
		return denied
	}
	proof, ok := localPushStageProof(c)
	if !ok || proof.SourceRevision != revision {
		return denied
	}
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		owner, source, fingerprint, err := s.localPushOperationIntentScopeTx(tx, c, sourceID, revision, proof)
		if err != nil || source.TargetNodeID == nil {
			return denied
		}
		now, err := localPushFirstDirectoryDBClock(tx)
		if err != nil {
			return denied
		}
		var latest meta.LocalPushOperationIntent
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id = ?", sourceID).Order("generation DESC").Take(&latest).Error; err != nil {
			return denied
		}
		if latest.ID != operationID || latest.Generation != generation ||
			latest.OwnerID != owner.ID || latest.OwnerSession != owner.SessionVersion ||
			latest.SourceRevision != source.Revision || latest.TargetNodeID != *source.TargetNodeID ||
			latest.DeviceID != proof.DeviceID || latest.RootID != proof.RootID ||
			latest.RootFingerprint != fingerprint || !now.Before(latest.ExpiresAt) {
			return denied
		}
		// The first-leaf writer holds this exact operation row FOR UPDATE
		// through its SQL COMMIT. An abort that follows that COMMIT must
		// never create a competing durable negative operation outcome.
		// Also fail closed if the immutable commit table is unavailable.
		if err := requireLocalPushOperationWithoutSQLCommitTx(tx, operationID); err != nil {
			return denied
		}
		if latest.State == meta.LocalPushOperationIntentAborted && latest.AbortedAt != nil {
			return nil // idempotent only for the same current owner-bound generation
		}
		if latest.State != meta.LocalPushOperationIntentReserved || latest.AbortedAt != nil {
			return denied
		}
		updated := tx.Model(&meta.LocalPushOperationIntent{}).
			Where("id = ? AND source_id = ? AND generation = ? AND state = ? AND aborted_at IS NULL",
				operationID, sourceID, generation, meta.LocalPushOperationIntentReserved).
			Updates(map[string]any{"state": meta.LocalPushOperationIntentAborted, "aborted_at": now})
		if updated.Error != nil || updated.RowsAffected != 1 {
			return denied
		}
		return c.Request.Context().Err()
	})
	if err != nil || c.Request.Context().Err() != nil {
		return denied
	}
	return nil
}
