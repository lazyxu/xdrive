package api

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const localPushNativeTerminalChallengeTTL = 15 * time.Second
const localPushNativeTerminalChallengeDomain = "xdrive/localpush/native-terminal-challenge-v1\x00"

// This is an INTERNAL correlation nonce, never an HTTP/JSON upload ticket.
// It proves only freshness of the current SQL Operation binding, not native
// file contents, kernel Writer Claim ownership or physical cancellation.
type localPushNativeTerminalChallengeTicket struct {
	operationID string
	stageID     string
	generation  uint64
	nonce       [32]byte
	expiresAt   time.Time
}

func (localPushNativeTerminalChallengeTicket) MarshalJSON() ([]byte, error) {
	return []byte("{}"), nil
}

func localPushNativeTerminalChallengeDigest(nonce [32]byte) string {
	input := make([]byte, 0, len(localPushNativeTerminalChallengeDomain)+len(nonce))
	input = append(input, localPushNativeTerminalChallengeDomain...)
	input = append(input, nonce[:]...)
	sum := sha256.Sum256(input)
	return hex.EncodeToString(sum[:])
}

type localPushNativeTerminalChallengeScope struct {
	owner       meta.User
	source      meta.Source
	operation   meta.LocalPushOperationIntent
	binding     meta.LocalPushOperationStageBinding
	keyDigest   string
	fingerprint string
	now         time.Time
}

// Every challenge issuance/consumption revalidates this immutable original
// SQL scope inside the SAME caller-retained transaction. Lock order is Owner
// SHARE -> Device UPDATE -> Source UPDATE -> Root SHARE -> Operation UPDATE ->
// Stage binding SHARE -> canonical SQL COMMIT SHARE -> challenge UPDATE.
// A SQL challenge alone is NEVER an independently held native OS handle.
func (s *Server) localPushNativeTerminalChallengeScopeTx(
	tx *gorm.DB, c *gin.Context, sourceID, revision uint64,
	proof localSourceExecutorProof, stageID string,
	requestKey []byte, operationID string, generation uint64,
) (localPushNativeTerminalChallengeScope, error) {
	var empty localPushNativeTerminalChallengeScope
	deny := errLocalPushOperationIntentDenied
	keyDigest, valid := localPushOperationRequestKeyDigest(requestKey)
	if s == nil || s.DB == nil || c == nil || c.Request == nil ||
		c.Request.Context().Err() != nil || !localPushFileTerminalHeldTx(tx) ||
		sourceID == 0 || revision == 0 || generation == 0 || !valid ||
		!validLocalPushPrepareOperationUUID(stageID) ||
		!validLocalPushPrepareOperationUUID(operationID) {
		return empty, deny
	}
	bound, ok := localPushStageProof(c)
	if !ok || bound != proof || proof.SourceRevision != revision {
		return empty, deny
	}
	owner, source, fingerprint, err := s.localPushOperationIntentScopeTx(
		tx, c, sourceID, revision, proof)
	if err != nil || source.TargetNodeID == nil ||
		source.SyncMode != meta.SourceSyncModeBackup ||
		source.Status != meta.SourceStatusPaused {
		return empty, deny
	}
	var operation meta.LocalPushOperationIntent
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND source_id = ? AND generation = ?",
			operationID, sourceID, generation).Take(&operation).Error; err != nil {
		return empty, deny
	}
	if operation.ID != operationID ||
		operation.SourceID != sourceID || operation.Generation != generation ||
		operation.OwnerID != owner.ID || operation.OwnerSession != owner.SessionVersion ||
		operation.DeviceID != proof.DeviceID || operation.RootID != proof.RootID ||
		operation.RootFingerprint != fingerprint ||
		operation.SourceRevision != revision ||
		operation.TargetNodeID != *source.TargetNodeID ||
		operation.RequestKeyDigest == nil ||
		subtle.ConstantTimeCompare([]byte(*operation.RequestKeyDigest), []byte(keyDigest)) != 1 ||
		operation.State != meta.LocalPushOperationIntentReserved ||
		operation.AbortedAt != nil || operation.IssuedAt.IsZero() ||
		!operation.ExpiresAt.After(operation.IssuedAt) {
		return empty, deny
	}
	if err := requireLocalPushFileTerminalVacantTx(tx, sourceID); err != nil {
		return empty, deny
	}
	var later, canceled int64
	if err := tx.Model(&meta.LocalPushOperationIntent{}).
		Where("source_id = ? AND generation > ?", sourceID, generation).
		Count(&later).Error; err != nil || later != 0 {
		return empty, deny
	}
	if err := tx.Model(&meta.LocalPushOperationTerminalReceipt{}).
		Where("operation_id = ?", operationID).Count(&canceled).Error; err != nil || canceled != 0 {
		// Reservation abort/expiry is never a trustworthy physical CANCEL.
		return empty, deny
	}
	var binding meta.LocalPushOperationStageBinding
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("stage_id = ? AND operation_id = ? AND source_id = ? AND generation = ?",
			stageID, operationID, sourceID, generation).Take(&binding).Error; err != nil {
		return empty, deny
	}
	if binding.OwnerID != owner.ID || binding.OwnerSession != owner.SessionVersion ||
		binding.DeviceID != proof.DeviceID || binding.RootID != proof.RootID ||
		binding.RootFingerprint != fingerprint || binding.SourceRevision != revision ||
		binding.TargetNodeID != *source.TargetNodeID ||
		subtle.ConstantTimeCompare([]byte(binding.RequestKeyDigest), []byte(keyDigest)) != 1 ||
		binding.TotalSize < 0 || binding.TotalSize > localPushStageMaxBytes ||
		!validLocalEvidenceDigest(binding.CurrentSnapshotSHA256) ||
		!validLocalEvidenceDigest(binding.CurrentPathKey) ||
		!validLocalEvidenceDigest(binding.ContentSHA256) ||
		binding.BoundAt.IsZero() || binding.BoundAt.Before(operation.IssuedAt) ||
		binding.BoundAt.After(operation.ExpiresAt) {
		return empty, deny
	}
	var committed meta.LocalPushFirstLeafOperationCommit
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("operation_id = ? AND source_id = ? AND stage_id = ? AND generation = ?",
			operationID, sourceID, stageID, generation).
		Take(&committed).Error; err != nil {
		return empty, deny
	}
	if committed.OwnerID != binding.OwnerID ||
		committed.OwnerSession != binding.OwnerSession ||
		committed.DeviceID != binding.DeviceID || committed.RootID != binding.RootID ||
		committed.RootFingerprint != binding.RootFingerprint ||
		committed.SourceRevision != binding.SourceRevision ||
		committed.TargetNodeID != binding.TargetNodeID ||
		subtle.ConstantTimeCompare([]byte(committed.RequestKeyDigest), []byte(keyDigest)) != 1 ||
		committed.CurrentSnapshotSHA256 != binding.CurrentSnapshotSHA256 ||
		committed.CurrentPathKey != binding.CurrentPathKey ||
		committed.ContentSHA256 != binding.ContentSHA256 ||
		committed.TotalSize != binding.TotalSize ||
		committed.NodeID == 0 || committed.SourceItemID == 0 ||
		committed.CommittedAt.IsZero() || committed.CommittedAt.Before(binding.BoundAt) ||
		committed.CommittedAt.After(operation.ExpiresAt) {
		return empty, deny
	}
	now, err := localPushFirstDirectoryDBClock(tx)
	if err != nil || now.Before(committed.CommittedAt) || c.Request.Context().Err() != nil {
		return empty, deny
	}
	return localPushNativeTerminalChallengeScope{
		owner: owner, source: source, operation: operation, binding: binding,
		keyDigest: keyDigest, fingerprint: fingerprint, now: now,
	}, nil
}

// issueBoundLocalPushNativeTerminalChallenge is deliberately UNROUTED. It
// stores one irrevocable original-operation nonce digest; a missing/expired
// challenge never permits another Stage/key/Writer. A lost challenge ACK
// cannot be retried by minting a replacement nonce. This is not an upload.
func (s *Server) issueBoundLocalPushNativeTerminalChallenge(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	stageID string, requestKey []byte, operationID string, generation uint64,
) (localPushNativeTerminalChallengeTicket, error) {
	var empty localPushNativeTerminalChallengeTicket
	deny := errLocalPushOperationIntentDenied
	if s == nil || s.DB == nil || s.Store == nil || c == nil ||
		c.Request == nil || c.Request.Context().Err() != nil {
		return empty, deny
	}
	if _, ok := s.Store.(*storage.Local); !ok {
		return empty, deny
	}
	var issued localPushNativeTerminalChallengeTicket
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		scope, err := s.localPushNativeTerminalChallengeScopeTx(
			tx, c, sourceID, revision, proof, stageID, requestKey, operationID, generation)
		if err != nil {
			return deny
		}
		// Never rotate/reissue, including after a lost ACK or expired ticket.
		// A failed schema lookup is also a hard denial, not an empty table.
		var count int64
		if err := tx.Model(&meta.LocalPushNativeTerminalChallenge{}).
			Where("operation_id = ? OR stage_id = ?", operationID, stageID).
			Count(&count).Error; err != nil || count != 0 {
			return deny
		}
		var nonce [32]byte
		if _, err := rand.Read(nonce[:]); err != nil || nonce == ([32]byte{}) {
			return deny
		}
		expiresAt := scope.now.Add(localPushNativeTerminalChallengeTTL)
		row := meta.LocalPushNativeTerminalChallenge{
			OperationID: operationID, StageID: stageID,
			SourceID: sourceID, Generation: generation,
			OwnerID: scope.owner.ID, OwnerSession: scope.owner.SessionVersion,
			DeviceID: proof.DeviceID, RootID: proof.RootID,
			RootFingerprint: scope.fingerprint, SourceRevision: revision,
			TargetNodeID:     *scope.source.TargetNodeID,
			RequestKeyDigest: scope.keyDigest,
			NonceSHA256:      localPushNativeTerminalChallengeDigest(nonce),
			State:            meta.LocalPushNativeTerminalChallengeIssued,
			IssuedAt:         scope.now, ExpiresAt: expiresAt,
		}
		if err := tx.Create(&row).Error; err != nil {
			return deny
		}
		issued = localPushNativeTerminalChallengeTicket{
			operationID: operationID, stageID: stageID,
			generation: generation, nonce: nonce, expiresAt: expiresAt,
		}
		return c.Request.Context().Err()
	})
	if err != nil || c.Request.Context().Err() != nil {
		return empty, deny
	}
	return issued, nil
}

// consumeBoundLocalPushNativeTerminalChallengeTx only marks a nonce used,
// within the caller's existing SQL transaction and Owner/Device/Root locks.
// The future trustworthy native bridge must STILL prove the live OS handle
// and Writer Claim independently. A successful consume cannot be treated as
// originalClaimHeld=true or physical-COMMIT/CANCEL authority.
func (s *Server) consumeBoundLocalPushNativeTerminalChallengeTx(
	tx *gorm.DB, c *gin.Context, sourceID, revision uint64,
	proof localSourceExecutorProof, stageID string, requestKey []byte,
	operationID string, generation uint64, nonce [32]byte,
) error {
	deny := errLocalPushOperationIntentDenied
	if nonce == ([32]byte{}) || c == nil || c.Request == nil ||
		c.Request.Context().Err() != nil {
		return deny
	}
	scope, err := s.localPushNativeTerminalChallengeScopeTx(
		tx, c, sourceID, revision, proof, stageID, requestKey, operationID, generation)
	if err != nil {
		return deny
	}
	var row meta.LocalPushNativeTerminalChallenge
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("operation_id = ? AND stage_id = ?", operationID, stageID).
		Take(&row).Error; err != nil {
		return deny
	}
	digest := localPushNativeTerminalChallengeDigest(nonce)
	if row.OperationID != operationID || row.StageID != stageID ||
		row.SourceID != sourceID || row.Generation != generation ||
		row.OwnerID != scope.owner.ID || row.OwnerSession != scope.owner.SessionVersion ||
		row.DeviceID != proof.DeviceID || row.RootID != proof.RootID ||
		row.RootFingerprint != scope.fingerprint ||
		row.SourceRevision != revision || row.TargetNodeID != *scope.source.TargetNodeID ||
		subtle.ConstantTimeCompare([]byte(row.RequestKeyDigest), []byte(scope.keyDigest)) != 1 ||
		subtle.ConstantTimeCompare([]byte(row.NonceSHA256), []byte(digest)) != 1 ||
		row.State != meta.LocalPushNativeTerminalChallengeIssued ||
		row.ConsumedAt != nil || row.IssuedAt.IsZero() ||
		row.ExpiresAt.IsZero() || row.ExpiresAt.Before(row.IssuedAt) ||
		scope.now.Before(row.IssuedAt) || !scope.now.Before(row.ExpiresAt) {
		return deny
	}
	updated := tx.Model(&meta.LocalPushNativeTerminalChallenge{}).
		Where("operation_id = ? AND stage_id = ? AND state = ? AND nonce_sha256 = ? AND consumed_at IS NULL",
			operationID, stageID, meta.LocalPushNativeTerminalChallengeIssued, digest).
		Updates(map[string]any{
			"state":       meta.LocalPushNativeTerminalChallengeConsumed,
			"consumed_at": scope.now,
		})
	if updated.Error != nil || updated.RowsAffected != 1 ||
		c.Request.Context().Err() != nil {
		return deny
	}
	return nil
}

// The public Server/Agent/IPC/Renderer has intentionally NO invocation of
// these routines. No challenge is a file-terminal result, backup result,
// cancellation witness or request-key retirement authorization.
