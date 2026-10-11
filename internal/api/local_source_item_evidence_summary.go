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

// The Server cannot attest a private Agent inventory; this is a COUNT of
// persisted advisory rows only, never a cloud rename or execution token.
type localEvidenceSummaryRequest struct {
	PreviousSnapshotSHA256 string `json:"previous_snapshot_sha256"`
	CurrentSnapshotSHA256  string `json:"current_snapshot_sha256"`
}

type localEvidenceSummaryResponse struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	StagedRecords        int64  `json:"staged_records"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

func validLocalEvidenceSummaryRequest(v localEvidenceSummaryRequest) bool {
	return validLocalEvidenceDigest(v.PreviousSnapshotSHA256) &&
		validLocalEvidenceDigest(v.CurrentSnapshotSHA256) &&
		v.PreviousSnapshotSHA256 != v.CurrentSnapshotSHA256
}

// This device-bound read-only endpoint does not enumerate or return any
// filesystem paths, SourceItem IDs, native keys, credentials or error text.
func (s *Server) readLocalSourceItemEvidenceSummary(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, valid := parseID(c.Param("id"))
	if !valid {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return
	}
	raw, ok := c.Get(localSourceExecutorContextKey)
	proof, proofOK := raw.(localSourceExecutorProof)
	if !ok || !proofOK || proof.DeviceID == "" || proof.RootID == "" {
		fail(c, http.StatusForbidden, "owning device and local Root required")
		return
	}
	expected, valid := expectedRevision(c)
	if !valid {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var input localEvidenceSummaryRequest
	if err := decoder.Decode(&input); err != nil || !validLocalEvidenceSummaryRequest(input) {
		fail(c, http.StatusBadRequest, "invalid local inventory generation")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "local inventory generation has trailing data")
		return
	}

	var revision uint64
	var count int64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// The device -> Source -> binding proof is repeated in the same
		// transaction as the aggregate read to fence revoke/revision races.
		if err := s.requireLocalSourceProofTx(tx, c, sourceID, "", false); err != nil {
			return err
		}
		var src meta.Source
		if err := tx.Select("id", "owner_id", "kind", "direction", "status", "revision").
			Where("id = ? AND owner_id = ?", sourceID, userID(c)).
			Take(&src).Error; err != nil {
			return err
		}
		revision = src.Revision
		if !isLocalFolderPush(src) {
			return errLocalBindingTypeInvalid
		}
		if src.Revision != expected {
			return errRevisionConflict
		}
		if src.Status != meta.SourceStatusPaused {
			return errLocalBindingStateInvalid
		}
		return tx.Model(&meta.LocalSourceItemEvidence{}).
			Where("source_id = ? AND source_revision = ? AND device_id = ? AND root_id = ? AND root_fingerprint = ?",
				sourceID, expected, proof.DeviceID, proof.RootID,
				strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint")))).
			Where("previous_snapshot_sha256 = ? AND current_snapshot_sha256 = ?",
				input.PreviousSnapshotSHA256, input.CurrentSnapshotSHA256).
			Count(&count).Error
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
			fail(c, http.StatusInternalServerError, "local evidence count unavailable")
		}
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localEvidenceSummaryResponse{
		SourceID: sourceID, Revision: revision, StagedRecords: count,
		Authoritative: false, MissingInferenceSafe: false,
	})
}
