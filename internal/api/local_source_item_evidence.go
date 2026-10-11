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

const localEvidenceRequestMaxBytes = 8 << 10

var errLocalEvidenceConflict = errors.New("local evidence conflicts with an existing identity")

// This is an owning Agent's UNTRUSTED native-observation assertion. Only
// verified CURRENT/PREVIOUS local journals can eventually produce it; this
// server cannot independently attest the Agent's private filesystem.
type localSourceItemEvidenceRequest struct {
	SourceItemID           uint64 `json:"source_item_id"`
	PreviousSnapshotSHA256 string `json:"previous_snapshot_sha256"`
	CurrentSnapshotSHA256  string `json:"current_snapshot_sha256"`
	PreviousPathKey        string `json:"previous_path_key"`
	CurrentPathKey         string `json:"current_path_key"`
	PreviousNativeKey      string `json:"previous_native_identity_key"`
	CurrentNativeKey       string `json:"current_native_identity_key"`
	PreviousStrong         bool   `json:"previous_strong_native_identity"`
	CurrentStrong          bool   `json:"current_strong_native_identity"`
	PreviousLinkCount      uint64 `json:"previous_link_count"`
	CurrentLinkCount       uint64 `json:"current_link_count"`
}

type localSourceItemEvidenceResponse struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	SourceItemID         uint64 `json:"source_item_id"`
	EvidenceID           uint64 `json:"evidence_id"`
	Stored               bool   `json:"stored"`
	Replayed             bool   `json:"replayed"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

func validLocalEvidenceDigest(value string) bool {
	if len(value) != sha256.Size*2 || strings.ToLower(value) != value ||
		value == strings.Repeat("0", sha256.Size*2) {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

func validLocalEvidenceClaim(input localSourceItemEvidenceRequest) bool {
	return input.SourceItemID != 0 &&
		validLocalEvidenceDigest(input.PreviousSnapshotSHA256) &&
		validLocalEvidenceDigest(input.CurrentSnapshotSHA256) &&
		input.PreviousSnapshotSHA256 != input.CurrentSnapshotSHA256 &&
		validLocalEvidenceDigest(input.PreviousPathKey) &&
		validLocalEvidenceDigest(input.CurrentPathKey) &&
		input.PreviousPathKey != input.CurrentPathKey &&
		validLocalEvidenceDigest(input.PreviousNativeKey) &&
		input.PreviousNativeKey == input.CurrentNativeKey &&
		input.PreviousStrong && input.CurrentStrong &&
		input.PreviousLinkCount == 1 && input.CurrentLinkCount == 1
}

func sameLocalSourceItemEvidence(a, b meta.LocalSourceItemEvidence) bool {
	return a.SourceID == b.SourceID && a.SourceRevision == b.SourceRevision &&
		a.SourceItemID == b.SourceItemID && a.DeviceID == b.DeviceID &&
		a.RootID == b.RootID && a.RootFingerprint == b.RootFingerprint &&
		a.PreviousSnapshotSHA256 == b.PreviousSnapshotSHA256 &&
		a.CurrentSnapshotSHA256 == b.CurrentSnapshotSHA256 &&
		a.PreviousPathKey == b.PreviousPathKey &&
		a.CurrentPathKey == b.CurrentPathKey &&
		a.NativeIdentityKey == b.NativeIdentityKey
}

// Persist an advisory ONLY: no SourceItem, SourceItemAlias, SyncRun, Node,
// CAS or Mirror state changes. In particular, it must not be used by generic
// identity resolution or as proof that a cloud rename/delete is safe.
func (s *Server) recordLocalSourceItemEvidence(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return
	}
	raw, exists := c.Get(localSourceExecutorContextKey)
	proof, proofOK := raw.(localSourceExecutorProof)
	if !exists || !proofOK || proof.RootID == "" || proof.DeviceID == "" {
		fail(c, http.StatusForbidden, "owning device and authorized local Root required")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localEvidenceRequestMaxBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var input localSourceItemEvidenceRequest
	if err := decoder.Decode(&input); err != nil || !validLocalEvidenceClaim(input) {
		fail(c, http.StatusBadRequest, "invalid or oversized local evidence")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "local evidence has trailing content")
		return
	}

	var stored meta.LocalSourceItemEvidence
	var currentRevision uint64
	created := false
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Device -> Source -> Root binding locks fence concurrent revocation
		// and changes to Source revision, exactly as for other local writes.
		if err := s.requireLocalSourceProofTx(tx, c, sourceID, "", false); err != nil {
			return err
		}
		var source meta.Source
		if err := tx.Where("id = ? AND owner_id = ?", sourceID, userID(c)).First(&source).Error; err != nil {
			return err
		}
		currentRevision = source.Revision
		if !isLocalFolderPush(source) {
			return errLocalBindingTypeInvalid
		}
		if source.Revision != expected {
			return errRevisionConflict
		}
		if source.Status != meta.SourceStatusPaused {
			return errLocalBindingStateInvalid
		}
		// Only a synced, stable existing file SourceItem with a live owned
		// cloud Node can have an advisory native-rename relation.
		var item meta.SourceItem
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND source_id = ?", input.SourceItemID, sourceID).
			Take(&item).Error; err != nil {
			return errLocalEvidenceConflict
		}
		if item.Kind != meta.SourceItemKindFile || item.State != meta.SourceItemStateSynced ||
			item.NodeID == nil || item.NodeRevision == 0 || item.ExternalID != input.PreviousPathKey {
			return errLocalEvidenceConflict
		}
		normalized, err := sourcepkg.NormalizeRelativePath(item.Path)
		if err != nil || normalized != item.Path || normalized == "" {
			return errLocalEvidenceConflict
		}
		// The previous path key is recomputed from the Server's actual
		// stored SourceItem path and *bound* Root ID; arbitrary previous keys
		// cannot claim another SourceItem on the same account.
		oldDigest := sha256.Sum256([]byte("xdrive-local-path-v1\x00" +
			proof.RootID + "\x00file\x00" + item.Path))
		if hex.EncodeToString(oldDigest[:]) != input.PreviousPathKey {
			return errLocalEvidenceConflict
		}
		var node meta.Node
		if err := tx.Select("id", "revision", "type").
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				*item.NodeID, source.OwnerID, meta.NodeTypeFile).
			Take(&node).Error; err != nil || node.Revision != item.NodeRevision {
			return errLocalEvidenceConflict
		}
		// Check both canonical and external-ID alias namespaces. The
		// new path must not already identify a different SourceItem.
		index, err := loadSourceIdentityIndex(tx, sourceID,
			[]string{input.PreviousPathKey, input.CurrentPathKey})
		if err != nil {
			return err
		}
		prior, found, err := index.resolve(input.PreviousPathKey, nil)
		if err != nil || !found || prior.ID != item.ID {
			return errLocalEvidenceConflict
		}
		now, found, err := index.resolve(input.CurrentPathKey, nil)
		if err != nil || (found && now.ID != item.ID) {
			return errLocalEvidenceConflict
		}
		row := meta.LocalSourceItemEvidence{
			SourceID: sourceID, SourceItemID: item.ID,
			SourceRevision: expected, DeviceID: proof.DeviceID,
			RootID: proof.RootID, RootFingerprint: strings.ToLower(
				strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint"))),
			PreviousSnapshotSHA256: input.PreviousSnapshotSHA256,
			CurrentSnapshotSHA256:  input.CurrentSnapshotSHA256,
			PreviousPathKey:        input.PreviousPathKey, CurrentPathKey: input.CurrentPathKey,
			NativeIdentityKey: input.CurrentNativeKey,
		}
		// One SourceItem can claim only one path per generation, and a
		// path only one SourceItem. Exact retries are idempotent;
		// conflicting replay MUST be rejected, not overwritten.
		var existingRows []meta.LocalSourceItemEvidence
		if err := tx.Where("source_id = ? AND source_revision = ? AND current_snapshot_sha256 = ?",
			sourceID, expected, row.CurrentSnapshotSHA256).
			Where("source_item_id = ? OR current_path_key = ?",
				row.SourceItemID, row.CurrentPathKey).
			Find(&existingRows).Error; err != nil {
			return err
		}
		if len(existingRows) != 0 {
			if len(existingRows) != 1 || !sameLocalSourceItemEvidence(existingRows[0], row) {
				return errLocalEvidenceConflict
			}
			stored = existingRows[0]
			return nil
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		stored = row
		created = true
		return c.Request.Context().Err()
	})
	if err != nil {
		switch {
		case errors.Is(err, errLocalSourceExecutorTransactionUnauthorized):
			fail(c, http.StatusForbidden, "owning device or local Root not authorized")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "Source not found")
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, errLocalEvidenceConflict), errors.Is(err, errLocalBindingStateInvalid):
			fail(c, http.StatusConflict, "local identity evidence conflicts with current Source")
		case errors.Is(err, errLocalBindingTypeInvalid):
			fail(c, http.StatusForbidden, "local folder Push Source required")
		default:
			fail(c, http.StatusInternalServerError, "local identity evidence unavailable")
		}
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(currentRevision, 10)))
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	c.JSON(status, localSourceItemEvidenceResponse{
		SourceID: sourceID, Revision: currentRevision, SourceItemID: input.SourceItemID,
		EvidenceID: stored.ID, Stored: true, Replayed: !created,
		Authoritative: false, MissingInferenceSafe: false,
	})
}
