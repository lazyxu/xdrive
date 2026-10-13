package api

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// This Agent-private, transaction-local claim is never a device-backup
// read DTO. A JSON serializer MUST NOT accidentally expose its path.
type localQuarantinedCurrentPathClaim struct {
	EvidenceID          uint64
	CurrentRelativePath string `json:"-"`
}

// Bind ordered private CURRENT paths to the Root-scoped inventory hash.
// Untrusted claims remain selectors, not proof of file contents/authority.
func localQuarantinedCurrentPathKeys(
	rootID string, input localEvidenceCloudMetadataRequest,
	claims []localQuarantinedCurrentPathClaim,
) ([]string, error) {
	if rootID == "" || !validLocalQuarantinedContentClaims(input) ||
		len(claims) != len(input.Items) {
		return nil, errLocalEvidenceConflict
	}
	keys := make([]string, 0, len(claims))
	seen := make(map[string]struct{}, len(claims))
	for i, claim := range claims {
		path := claim.CurrentRelativePath
		normalized, err := sourcepkg.NormalizeRelativePath(path)
		if claim.EvidenceID != input.Items[i].EvidenceID ||
			err != nil || normalized == "" || normalized != path ||
			strings.ContainsAny(path, ":\x00\r\n") {
			return nil, errLocalEvidenceConflict
		}
		if _, exists := seen[path]; exists {
			return nil, errLocalEvidenceConflict
		}
		seen[path] = struct{}{}
		sum := sha256.Sum256([]byte("xdrive-local-path-v1\x00" +
			rootID + "\x00file\x00" + path))
		keys = append(keys, hex.EncodeToString(sum[:]))
	}
	return keys, nil
}

// This INTERNAL read-only prerequisite first revalidates native device/Root,
// Source revision, quarantine, SourceItem/alias/Node/File/Version/READY CAS
// and takes GC hash locks through the existing SAME-transaction guard.
// It then matches the current relative path to the persisted quarantined
// path key, without exposing the path or modifying any canonical record.
//
// It is not a verified native-byte or physical CAS lifetime guarantee.
// A later writer must independently verify physical content and own-device
// authority at its commit boundary, with exact idempotence/recovery.
func (s *Server) checkLocalQuarantinedCurrentPathsTx(
	tx *gorm.DB, c *gin.Context, sourceID, revision uint64,
	proof localSourceExecutorProof, input localEvidenceCloudMetadataRequest,
	claims []localQuarantinedCurrentPathClaim,
) (localEvidenceCloudTxSnapshot, error) {
	empty := localEvidenceCloudTxSnapshot{}
	if tx == nil || c == nil || c.Request == nil || sourceID == 0 || revision == 0 {
		return empty, errLocalEvidenceConflict
	}
	keys, err := localQuarantinedCurrentPathKeys(proof.RootID, input, claims)
	if err != nil {
		return empty, err
	}
	snapshot, err := s.checkLocalQuarantinedCASRetentionTx(
		tx, c, sourceID, revision, proof, input)
	if err != nil {
		return empty, err
	}
	ids := make([]uint64, 0, len(input.Items))
	for _, claim := range claims {
		ids = append(ids, claim.EvidenceID)
	}
	var rows []meta.LocalSourceCommitIntent
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("source_id = ? AND source_revision = ? AND device_id = ? AND root_id = ? AND root_fingerprint = ?",
			sourceID, revision, proof.DeviceID, proof.RootID,
			strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint")))).
		Where("previous_snapshot_sha256 = ? AND current_snapshot_sha256 = ? AND state = ?",
			input.PreviousSnapshotSHA256, input.CurrentSnapshotSHA256,
			meta.LocalSourceCommitIntentStateQuarantined).
		Where("evidence_id IN ?", ids).
		Order("evidence_id ASC").Limit(len(ids)).Find(&rows).Error; err != nil {
		return empty, err
	}
	if len(rows) != len(claims) || snapshot.revision != revision ||
		len(snapshot.objects) != len(claims) {
		return empty, errLocalEvidenceConflict
	}
	for i, row := range rows {
		if row.EvidenceID != claims[i].EvidenceID ||
			row.CurrentPathKey != keys[i] ||
			row.PreviousPathKey == keys[i] {
			return empty, errLocalEvidenceConflict
		}
	}
	if err := c.Request.Context().Err(); err != nil {
		return empty, err
	}
	return snapshot, nil
}
