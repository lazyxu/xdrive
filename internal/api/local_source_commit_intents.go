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
	localCommitIntentMaxBytes = 2 << 10
	localCommitIntentMaxItems = 16
)

var errLocalCommitIntentConflict = errors.New("local commit intent conflicts with current evidence")

// Only a QUARANTINED proposal. It must never be used by a SourceItem writer,
// upload executor or Mirror planner as an authorization or content proof.
type localCommitIntentResponse struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	Quarantined          int    `json:"quarantined"`
	Replayed             int    `json:"replayed"`
	CommitSupported      bool   `json:"commit_supported"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

func validLocalCommitIntentRequest(v localEvidencePreflightRequest) bool {
	return validLocalEvidencePreflightRequest(v) && len(v.EvidenceIDs) <= localCommitIntentMaxItems
}

func sameQuarantinedLocalIntent(a, b meta.LocalSourceCommitIntent) bool {
	return a.SourceID == b.SourceID &&
		a.SourceRevision == b.SourceRevision &&
		a.EvidenceID == b.EvidenceID &&
		a.CurrentSnapshotSHA256 == b.CurrentSnapshotSHA256 &&
		a.SourceItemID == b.SourceItemID &&
		a.CurrentPathKey == b.CurrentPathKey &&
		a.PreviousSnapshotSHA256 == b.PreviousSnapshotSHA256 &&
		a.PreviousPathKey == b.PreviousPathKey &&
		a.NativeIdentityKey == b.NativeIdentityKey &&
		a.DeviceID == b.DeviceID &&
		a.RootID == b.RootID &&
		a.RootFingerprint == b.RootFingerprint &&
		a.State == meta.LocalSourceCommitIntentStateQuarantined
}

// quarantineLocalSourceCommitIntents records at most 16 revision-bound
// candidate references after transaction-scoped device→Source→Root,
// SourceItem→alias→Node consistency checks. The result is ADVISORY and
// deliberately does NOT read/hash bytes or update any canonical identity.
//
// An eventual L03-E writer must independently recheck original live bytes,
// physical CAS, complete journals, target ownership and conflicts before
// changing a SourceItem. A prior successful read or this record is NEVER a
// commit token. This endpoint is accessible only to an owning native Agent.
func (s *Server) quarantineLocalSourceCommitIntents(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return
	}
	raw, exists := c.Get(localSourceExecutorContextKey)
	proof, proofOK := raw.(localSourceExecutorProof)
	if !exists || !proofOK || proof.DeviceID == "" || proof.RootID == "" {
		fail(c, http.StatusForbidden, "owning device and Root required")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localCommitIntentMaxBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var input localEvidencePreflightRequest
	if err := decoder.Decode(&input); err != nil || !validLocalCommitIntentRequest(input) {
		fail(c, http.StatusBadRequest, "invalid or oversized local commit intent")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "local commit intent has trailing content")
		return
	}

	var revision uint64
	created, replayed := 0, 0
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Must precede Source/Root/evidence locks. Revocation uses device-first.
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
		fingerprint := strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint")))
		var rows []meta.LocalSourceItemEvidence
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id = ? AND source_revision = ? AND device_id = ? AND root_id = ? AND root_fingerprint = ?",
				sourceID, revision, proof.DeviceID, proof.RootID, fingerprint).
			Where("previous_snapshot_sha256 = ? AND current_snapshot_sha256 = ?",
				input.PreviousSnapshotSHA256, input.CurrentSnapshotSHA256).
			Where("id IN ?", input.EvidenceIDs).
			Order("id ASC").Limit(localCommitIntentMaxItems).Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) != len(input.EvidenceIDs) {
			return errLocalCommitIntentConflict
		}
		itemIDs := make([]uint64, 0, len(rows))
		keys := make([]string, 0, 2*len(rows))
		seenItems := make(map[uint64]struct{}, len(rows))
		seenDestinations := make(map[string]struct{}, len(rows))
		for i, row := range rows {
			if row.ID != input.EvidenceIDs[i] || row.SourceItemID == 0 ||
				!validLocalEvidenceDigest(row.PreviousPathKey) ||
				!validLocalEvidenceDigest(row.CurrentPathKey) ||
				!validLocalEvidenceDigest(row.NativeIdentityKey) ||
				row.PreviousPathKey == row.CurrentPathKey {
				return errLocalCommitIntentConflict
			}
			if _, seen := seenItems[row.SourceItemID]; seen {
				return errLocalCommitIntentConflict
			}
			if _, seen := seenDestinations[row.CurrentPathKey]; seen {
				return errLocalCommitIntentConflict
			}
			seenItems[row.SourceItemID] = struct{}{}
			seenDestinations[row.CurrentPathKey] = struct{}{}
			itemIDs = append(itemIDs, row.SourceItemID)
			keys = append(keys, row.PreviousPathKey, row.CurrentPathKey)
		}
		var items []meta.SourceItem
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id = ? AND id IN ?", sourceID, itemIDs).
			Order("id ASC").Find(&items).Error; err != nil {
			return err
		}
		if len(items) != len(rows) {
			return errLocalCommitIntentConflict
		}
		byID := make(map[uint64]meta.SourceItem, len(items))
		for _, item := range items {
			byID[item.ID] = item
		}
		index, err := loadSourceIdentityIndex(tx, sourceID, keys)
		if err != nil {
			return errLocalCommitIntentConflict
		}
		var existing []meta.LocalSourceCommitIntent
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id = ? AND evidence_id IN ?", sourceID, input.EvidenceIDs).
			Order("evidence_id ASC").Find(&existing).Error; err != nil {
			return err
		}
		byEvidence := make(map[uint64]meta.LocalSourceCommitIntent, len(existing))
		for _, item := range existing {
			if _, duplicate := byEvidence[item.EvidenceID]; duplicate {
				return errLocalCommitIntentConflict
			}
			byEvidence[item.EvidenceID] = item
		}
		// Validate the ENTIRE batch before inserting even its first row.
		proposals := make([]meta.LocalSourceCommitIntent, 0, len(rows))
		for _, row := range rows {
			item, found := byID[row.SourceItemID]
			if !found || item.Kind != meta.SourceItemKindFile ||
				item.State != meta.SourceItemStateSynced || item.NodeID == nil ||
				item.NodeRevision == 0 || item.ExternalID != row.PreviousPathKey {
				return errLocalCommitIntentConflict
			}
			relative, err := sourcepkg.NormalizeRelativePath(item.Path)
			if err != nil || relative == "" || relative != item.Path {
				return errLocalCommitIntentConflict
			}
			digest := sha256.Sum256([]byte("xdrive-local-path-v1\x00" +
				proof.RootID + "\x00file\x00" + item.Path))
			if hex.EncodeToString(digest[:]) != row.PreviousPathKey {
				return errLocalCommitIntentConflict
			}
			old, found, err := index.resolve(row.PreviousPathKey, nil)
			if err != nil || !found || old.ID != item.ID {
				return errLocalCommitIntentConflict
			}
			next, found, err := index.resolve(row.CurrentPathKey, nil)
			if err != nil || (found && next.ID != item.ID) {
				return errLocalCommitIntentConflict
			}
			var node meta.Node
			if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
				Select("id", "owner_id", "type", "revision", "deleted_at").
				Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
					*item.NodeID, source.OwnerID, meta.NodeTypeFile).
				Take(&node).Error; err != nil || node.Revision != item.NodeRevision {
				return errLocalCommitIntentConflict
			}
			intent := meta.LocalSourceCommitIntent{
				SourceID: sourceID, SourceRevision: revision,
				EvidenceID: row.ID, SourceItemID: row.SourceItemID,
				PreviousSnapshotSHA256: row.PreviousSnapshotSHA256,
				CurrentSnapshotSHA256:  row.CurrentSnapshotSHA256,
				PreviousPathKey:        row.PreviousPathKey, CurrentPathKey: row.CurrentPathKey,
				NativeIdentityKey: row.NativeIdentityKey, DeviceID: proof.DeviceID,
				RootID: proof.RootID, RootFingerprint: fingerprint,
				State: meta.LocalSourceCommitIntentStateQuarantined,
			}
			if prior, ok := byEvidence[row.ID]; ok {
				if !sameQuarantinedLocalIntent(prior, intent) {
					return errLocalCommitIntentConflict
				}
				replayed++
				continue
			}
			proposals = append(proposals, intent)
		}
		for _, intent := range proposals {
			if err := tx.Create(&intent).Error; err != nil {
				return errLocalCommitIntentConflict
			}
			created++
		}
		return c.Request.Context().Err()
	})
	if err != nil {
		switch {
		case errors.Is(err, errLocalSourceExecutorTransactionUnauthorized):
			fail(c, http.StatusForbidden, "owning device or Root not authorized")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "local Source not found")
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, revision)
		case errors.Is(err, errLocalBindingTypeInvalid):
			fail(c, http.StatusForbidden, "local folder Push required")
		case errors.Is(err, errLocalBindingStateInvalid), errors.Is(err, errLocalCommitIntentConflict):
			fail(c, http.StatusConflict, "local evidence no longer eligible for quarantine")
		default:
			fail(c, http.StatusInternalServerError, "local quarantine unavailable")
		}
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	status := http.StatusCreated
	if created == 0 {
		status = http.StatusOK
	}
	c.JSON(status, localCommitIntentResponse{
		SourceID: sourceID, Revision: revision,
		Quarantined: created, Replayed: replayed,
		CommitSupported: false, Authoritative: false, MissingInferenceSafe: false,
	})
}
