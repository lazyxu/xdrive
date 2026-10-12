package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	localEvidencePreflightLimit    = 64
	localEvidencePreflightMaxBytes = 2 << 10
)

// A bounded, private, read-only consistency check. No verification token is
// issued and this cannot authorize an upload, rename or SourceRun transition.
// Filesystem contents cannot be attested from a Server-side DB snapshot.
type localEvidencePreflightRequest struct {
	PreviousSnapshotSHA256 string   `json:"previous_snapshot_sha256"`
	CurrentSnapshotSHA256  string   `json:"current_snapshot_sha256"`
	EvidenceIDs            []uint64 `json:"evidence_ids"`
}

type localEvidencePreflightResponse struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	Checked              int    `json:"checked"`
	ServerConsistent     bool   `json:"server_consistent"`
	ContentVerified      bool   `json:"content_verified"`
	CommitSupported      bool   `json:"commit_supported"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

func validLocalEvidencePreflightRequest(v localEvidencePreflightRequest) bool {
	if !validLocalEvidenceDigest(v.PreviousSnapshotSHA256) ||
		!validLocalEvidenceDigest(v.CurrentSnapshotSHA256) ||
		v.PreviousSnapshotSHA256 == v.CurrentSnapshotSHA256 ||
		len(v.EvidenceIDs) == 0 || len(v.EvidenceIDs) > localEvidencePreflightLimit {
		return false
	}
	var prior uint64
	for _, id := range v.EvidenceIDs {
		if id <= prior {
			return false
		}
		prior = id
	}
	return true
}

// Each candidate must STILL identify the original, synced SourceItem with
// its current live Node revision and conflict-free old/new external ID keys.
// Even a passing check is only momentary DB evidence; a future mutation must
// repeat all checks in its OWN transaction and independently verify bytes.
func (s *Server) preflightLocalSourceItemEvidence(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return
	}
	raw, hasProof := c.Get(localSourceExecutorContextKey)
	proof, proofOK := raw.(localSourceExecutorProof)
	if !hasProof || !proofOK || proof.DeviceID == "" || proof.RootID == "" {
		fail(c, http.StatusForbidden, "owning device and Root required")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localEvidencePreflightMaxBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var input localEvidencePreflightRequest
	if err := decoder.Decode(&input); err != nil || !validLocalEvidencePreflightRequest(input) {
		fail(c, http.StatusBadRequest, "invalid or oversized local evidence preflight")
		return
	}
	var tail any
	if err := decoder.Decode(&tail); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "local evidence preflight has trailing content")
		return
	}

	var revision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Device -> Source -> Root locks fence owner revoke and source edits.
		if err := s.requireLocalSourceProofTx(tx, c, sourceID, "", false); err != nil {
			return err
		}
		var source meta.Source
		if err := tx.Select("id", "owner_id", "kind", "direction", "status", "revision").
			Where("id = ? AND owner_id = ?", sourceID, userID(c)).Take(&source).Error; err != nil {
			return err
		}
		revision = source.Revision
		if !isLocalFolderPush(source) {
			return errLocalBindingTypeInvalid
		}
		if revision != expected {
			return errRevisionConflict
		}
		if source.Status != meta.SourceStatusPaused {
			return errLocalBindingStateInvalid
		}
		var rows []meta.LocalSourceItemEvidence
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("source_id = ? AND source_revision = ? AND device_id = ? AND root_id = ? AND root_fingerprint = ?",
				sourceID, revision, proof.DeviceID, proof.RootID,
				strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint")))).
			Where("previous_snapshot_sha256 = ? AND current_snapshot_sha256 = ?",
				input.PreviousSnapshotSHA256, input.CurrentSnapshotSHA256).
			Where("id IN ?", input.EvidenceIDs).
			Order("id ASC").Limit(localEvidencePreflightLimit).
			Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) != len(input.EvidenceIDs) {
			return errLocalEvidenceConflict
		}
		ids := make([]uint64, 0, len(rows))
		keys := make([]string, 0, 2*len(rows))
		usedItems := make(map[uint64]struct{}, len(rows))
		usedNewPaths := make(map[string]struct{}, len(rows))
		for i, row := range rows {
			if row.ID != input.EvidenceIDs[i] || row.SourceItemID == 0 ||
				!validLocalEvidenceDigest(row.PreviousPathKey) ||
				!validLocalEvidenceDigest(row.CurrentPathKey) ||
				!validLocalEvidenceDigest(row.NativeIdentityKey) ||
				row.PreviousPathKey == row.CurrentPathKey {
				return errLocalEvidenceConflict
			}
			if _, found := usedItems[row.SourceItemID]; found {
				return errLocalEvidenceConflict
			}
			if _, found := usedNewPaths[row.CurrentPathKey]; found {
				return errLocalEvidenceConflict
			}
			usedItems[row.SourceItemID] = struct{}{}
			usedNewPaths[row.CurrentPathKey] = struct{}{}
			ids = append(ids, row.SourceItemID)
			keys = append(keys, row.PreviousPathKey, row.CurrentPathKey)
		}

		var items []meta.SourceItem
		// Match the alias index's UPDATE lock mode from the first item
		// acquisition, avoiding later SHARE -> UPDATE lock upgrades.
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id = ? AND id IN ?", sourceID, ids).
			Order("id ASC").Find(&items).Error; err != nil {
			return err
		}
		if len(items) != len(ids) {
			return errLocalEvidenceConflict
		}
		byID := make(map[uint64]meta.SourceItem, len(items))
		for _, item := range items {
			byID[item.ID] = item
		}

		// Inspect the existing canonical and alias namespaces, including
		// aliases to deleted/mismatched items. Conflict always fails closed.
		index, err := loadSourceIdentityIndex(tx, sourceID, keys)
		if err != nil {
			return errLocalEvidenceConflict
		}
		for _, row := range rows {
			item, exists := byID[row.SourceItemID]
			if !exists || item.Kind != meta.SourceItemKindFile ||
				item.State != meta.SourceItemStateSynced || item.NodeID == nil ||
				item.NodeRevision == 0 || item.ExternalID != row.PreviousPathKey {
				return errLocalEvidenceConflict
			}
			relative, err := sourcepkg.NormalizeRelativePath(item.Path)
			if err != nil || relative == "" || relative != item.Path {
				return errLocalEvidenceConflict
			}
			digest := sha256.Sum256([]byte("xdrive-local-path-v1\x00" +
				proof.RootID + "\x00file\x00" + item.Path))
			if hex.EncodeToString(digest[:]) != row.PreviousPathKey {
				return errLocalEvidenceConflict
			}
			old, found, err := index.resolve(row.PreviousPathKey, nil)
			if err != nil || !found || old.ID != item.ID {
				return errLocalEvidenceConflict
			}
			newItem, found, err := index.resolve(row.CurrentPathKey, nil)
			if err != nil || (found && newItem.ID != item.ID) {
				return errLocalEvidenceConflict
			}
			var node meta.Node
			if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
				Select("id", "owner_id", "type", "revision", "deleted_at").
				Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
					*item.NodeID, source.OwnerID, meta.NodeTypeFile).
				Take(&node).Error; err != nil || node.Revision != item.NodeRevision {
				return errLocalEvidenceConflict
			}
		}
		return c.Request.Context().Err()
	})
	if err != nil {
		switch {
		case errors.Is(err, errLocalSourceExecutorTransactionUnauthorized):
			fail(c, http.StatusForbidden, "owning device or local Root not authorized")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "local Source not found")
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, revision)
		case errors.Is(err, errLocalBindingStateInvalid), errors.Is(err, errLocalEvidenceConflict):
			fail(c, http.StatusConflict, "local advisory evidence no longer consistent")
		case errors.Is(err, errLocalBindingTypeInvalid):
			fail(c, http.StatusForbidden, "local Push Source required")
		default:
			fail(c, http.StatusInternalServerError, "local evidence preflight unavailable")
		}
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localEvidencePreflightResponse{
		SourceID: sourceID, Revision: revision, Checked: len(input.EvidenceIDs),
		ServerConsistent: true, ContentVerified: false, CommitSupported: false,
		Authoritative: false, MissingInferenceSafe: false,
	})
}
