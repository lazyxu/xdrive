package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const localCommitIntentReadMaxBytes = 512

// A private, revision-bound keyset read of QUARANTINED proposals only.
// A persisted proposal is never an identity commit or proof of CAS durability.
type localCommitIntentPageRequest struct {
	PreviousSnapshotSHA256 string `json:"previous_snapshot_sha256"`
	CurrentSnapshotSHA256  string `json:"current_snapshot_sha256"`
	AfterEvidenceID        uint64 `json:"after_evidence_id"`
	Limit                  int    `json:"limit"`
}

type localCommitIntentPageResponse struct {
	SourceID             uint64   `json:"source_id"`
	Revision             uint64   `json:"revision"`
	EvidenceIDs          []uint64 `json:"quarantined_evidence_ids"`
	HasMore              bool     `json:"has_more"`
	NextAfterID          uint64   `json:"next_after_id"`
	CommitSupported      bool     `json:"commit_supported"`
	Authoritative        bool     `json:"authoritative"`
	MissingInferenceSafe bool     `json:"missing_inference_safe"`
}

func validLocalCommitIntentPageRequest(v localCommitIntentPageRequest) bool {
	return v.Limit >= 1 && v.Limit <= localCommitIntentMaxItems &&
		validLocalEvidenceDigest(v.PreviousSnapshotSHA256) &&
		validLocalEvidenceDigest(v.CurrentSnapshotSHA256) &&
		v.PreviousSnapshotSHA256 != v.CurrentSnapshotSHA256
}

// readLocalSourceCommitIntentPage is strictly owning-Agent-private. POST keeps
// sealed generation hashes out of URL logs, browser caches and link previews.
// The locked device/Source/Root proof is checked before the bounded keyset
// read, so owner JWT or same-account Desktop B cannot recover A's proposal IDs.
// Only the private Agent may use the IDs to resolve an ambiguous quarantine
// retry; they must NOT become an executor queue or an L03-E1 commit token.
func (s *Server) readLocalSourceCommitIntentPage(c *gin.Context) {
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
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localCommitIntentReadMaxBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var input localCommitIntentPageRequest
	if err := decoder.Decode(&input); err != nil || !validLocalCommitIntentPageRequest(input) {
		fail(c, http.StatusBadRequest, "invalid local commit intent page")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "local commit intent page has trailing content")
		return
	}

	var revision uint64
	var rows []meta.LocalSourceCommitIntent
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Device row first, then Source and binding: identical ordering to
		// revocation and quarantine writes; never authorize with JWT alone.
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
		return tx.Model(&meta.LocalSourceCommitIntent{}).
			Select("evidence_id").
			Where("source_id = ? AND source_revision = ? AND device_id = ? AND root_id = ? AND root_fingerprint = ?",
				sourceID, expected, proof.DeviceID, proof.RootID,
				strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint")))).
			Where("previous_snapshot_sha256 = ? AND current_snapshot_sha256 = ? AND state = ?",
				input.PreviousSnapshotSHA256, input.CurrentSnapshotSHA256,
				meta.LocalSourceCommitIntentStateQuarantined).
			Where("evidence_id > ?", input.AfterEvidenceID).
			Order("evidence_id ASC").Limit(input.Limit + 1).Find(&rows).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errLocalSourceExecutorTransactionUnauthorized):
			fail(c, http.StatusForbidden, "owning device or Root not authorized")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "local Source not found")
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, revision)
		case errors.Is(err, errLocalBindingStateInvalid):
			fail(c, http.StatusConflict, "local Source must remain paused")
		case errors.Is(err, errLocalBindingTypeInvalid):
			fail(c, http.StatusForbidden, "local Push Source required")
		default:
			fail(c, http.StatusInternalServerError, "private quarantine read unavailable")
		}
		return
	}
	if c.Request.Context().Err() != nil {
		return
	}
	hasMore := len(rows) > input.Limit
	if hasMore {
		rows = rows[:input.Limit]
	}
	ids := make([]uint64, 0, len(rows))
	var nextID uint64
	for _, row := range rows {
		ids = append(ids, row.EvidenceID)
		nextID = row.EvidenceID
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localCommitIntentPageResponse{
		SourceID: sourceID, Revision: revision, EvidenceIDs: ids,
		HasMore: hasMore, NextAfterID: nextID,
		CommitSupported: false, Authoritative: false, MissingInferenceSafe: false,
	})
}
