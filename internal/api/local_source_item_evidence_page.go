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

const (
	localEvidencePageLimit    = 64
	localEvidencePageMaxBytes = 512
)

// This page contains only pre-existing, NON-AUTHORITATIVE native rename
// candidates. No caller of this endpoint gains execution, alias promotion,
// SourceItem mutation, CAS upload or Mirror deletion rights.
type localEvidencePageRequest struct {
	PreviousSnapshotSHA256 string `json:"previous_snapshot_sha256"`
	CurrentSnapshotSHA256  string `json:"current_snapshot_sha256"`
	AfterEvidenceID        uint64 `json:"after_evidence_id"`
	Limit                  int    `json:"limit"`
}

type localEvidencePageItem struct {
	EvidenceID        uint64 `json:"evidence_id"`
	SourceItemID      uint64 `json:"source_item_id"`
	PreviousPathKey   string `json:"previous_path_key"`
	CurrentPathKey    string `json:"current_path_key"`
	NativeIdentityKey string `json:"native_identity_key"`
}

type localEvidencePageResponse struct {
	SourceID             uint64                  `json:"source_id"`
	Revision             uint64                  `json:"revision"`
	Items                []localEvidencePageItem `json:"items"`
	HasMore              bool                    `json:"has_more"`
	NextAfterID          uint64                  `json:"next_after_id"`
	Authoritative        bool                    `json:"authoritative"`
	MissingInferenceSafe bool                    `json:"missing_inference_safe"`
}

func validLocalEvidencePageRequest(req localEvidencePageRequest) bool {
	return req.Limit >= 1 && req.Limit <= localEvidencePageLimit &&
		validLocalEvidenceDigest(req.PreviousSnapshotSHA256) &&
		validLocalEvidenceDigest(req.CurrentSnapshotSHA256) &&
		req.PreviousSnapshotSHA256 != req.CurrentSnapshotSHA256
}

// Read-only POST avoids sending private inventory digests in URLs or caches.
// Both the Source admission and keyset query are inside one transaction,
// with device -> Source -> binding proof rechecked before any candidate read.
// Paths, Root identity, device tokens and free-form errors never leave the
// Server. HasMore is based on limit+1; a full-table COUNT is not required.
func (s *Server) readLocalSourceItemEvidencePage(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return
	}
	raw, exists := c.Get(localSourceExecutorContextKey)
	proof, proofOK := raw.(localSourceExecutorProof)
	if !exists || !proofOK || proof.DeviceID == "" || proof.RootID == "" {
		fail(c, http.StatusForbidden, "owning device and local Root required")
		return
	}
	expected, valid := expectedRevision(c)
	if !valid {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localEvidencePageMaxBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var input localEvidencePageRequest
	if err := decoder.Decode(&input); err != nil || !validLocalEvidencePageRequest(input) {
		fail(c, http.StatusBadRequest, "invalid or oversized local evidence page")
		return
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "local evidence page contains trailing data")
		return
	}

	var revision uint64
	var rows []meta.LocalSourceItemEvidence
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
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
		if source.Revision != expected {
			return errRevisionConflict
		}
		if source.Status != meta.SourceStatusPaused {
			return errLocalBindingStateInvalid
		}
		err := tx.Model(&meta.LocalSourceItemEvidence{}).
			Select("id", "source_item_id", "previous_path_key", "current_path_key", "native_identity_key").
			Where("source_id = ? AND source_revision = ? AND device_id = ? AND root_id = ? AND root_fingerprint = ?",
				sourceID, expected, proof.DeviceID, proof.RootID,
				strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint")))).
			Where("previous_snapshot_sha256 = ? AND current_snapshot_sha256 = ?",
				input.PreviousSnapshotSHA256, input.CurrentSnapshotSHA256).
			Where("id > ?", input.AfterEvidenceID).
			Order("id ASC").Limit(input.Limit + 1).Find(&rows).Error
		if err != nil {
			return err
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
		case errors.Is(err, errLocalBindingStateInvalid):
			fail(c, http.StatusConflict, "local Source must remain paused")
		case errors.Is(err, errLocalBindingTypeInvalid):
			fail(c, http.StatusForbidden, "local Push Source required")
		default:
			fail(c, http.StatusInternalServerError, "private local evidence page unavailable")
		}
		return
	}
	hasMore := len(rows) > input.Limit
	if hasMore {
		rows = rows[:input.Limit]
	}
	items := make([]localEvidencePageItem, 0, len(rows))
	var nextID uint64
	for _, row := range rows {
		items = append(items, localEvidencePageItem{
			EvidenceID: row.ID, SourceItemID: row.SourceItemID,
			PreviousPathKey: row.PreviousPathKey, CurrentPathKey: row.CurrentPathKey,
			NativeIdentityKey: row.NativeIdentityKey,
		})
		nextID = row.ID
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localEvidencePageResponse{
		SourceID: sourceID, Revision: revision, Items: items,
		HasMore: hasMore, NextAfterID: nextID,
		Authoritative: false, MissingInferenceSafe: false,
	})
}
