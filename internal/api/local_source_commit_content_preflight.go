package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// L03-E1a is a read-only prerequisite, not an identity promotion endpoint.
// An Agent-asserted local hash and a momentarily readable CAS object do not
// constitute an atomic native-file/remote-CAS commit proof.
type localQuarantinedContentResponse struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	Checked              int    `json:"checked"`
	QuarantineMatched    bool   `json:"quarantine_matched"`
	PhysicalCASMatched   bool   `json:"physical_cas_matched"`
	CloudBytesVerified   bool   `json:"cloud_bytes_verified"`
	ContentVerified      bool   `json:"content_verified"`
	CommitSupported      bool   `json:"commit_supported"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

func validLocalQuarantinedContentClaims(input localEvidenceCloudMetadataRequest) bool {
	return validLocalEvidenceCloudMetadataRequest(input) &&
		validLocalEvidencePhysicalCASBatch(input.Items)
}

// Only complete, current, unchanged QUARANTINED rows qualify for this
// temporary physical-content probe. Never use the result as permission to
// update SourceItem, alias, Node, CAS, SourceRun or Mirror state.
func sameLocalQuarantinedEvidence(
	intent meta.LocalSourceCommitIntent, evidence meta.LocalSourceItemEvidence,
	sourceID, revision uint64, proof localSourceExecutorProof, fingerprint string,
) bool {
	if evidence.ID == 0 || evidence.SourceItemID == 0 ||
		!validLocalEvidenceDigest(evidence.PreviousPathKey) ||
		!validLocalEvidenceDigest(evidence.CurrentPathKey) ||
		!validLocalEvidenceDigest(evidence.NativeIdentityKey) ||
		evidence.PreviousPathKey == evidence.CurrentPathKey {
		return false
	}
	return sameQuarantinedLocalIntent(intent, meta.LocalSourceCommitIntent{
		SourceID: sourceID, SourceRevision: revision,
		EvidenceID: evidence.ID, SourceItemID: evidence.SourceItemID,
		PreviousSnapshotSHA256: evidence.PreviousSnapshotSHA256,
		CurrentSnapshotSHA256:  evidence.CurrentSnapshotSHA256,
		PreviousPathKey:        evidence.PreviousPathKey, CurrentPathKey: evidence.CurrentPathKey,
		NativeIdentityKey: evidence.NativeIdentityKey,
		DeviceID:          proof.DeviceID, RootID: proof.RootID,
		RootFingerprint: fingerprint, State: meta.LocalSourceCommitIntentStateQuarantined,
	}) && evidence.SourceID == sourceID && evidence.SourceRevision == revision &&
		evidence.DeviceID == proof.DeviceID && evidence.RootID == proof.RootID &&
		evidence.RootFingerprint == fingerprint
}

// Re-reads persisted quarantine and its immutable originating evidence with
// device-first transaction fencing; input IDs are only selectors, not proof.
// The independent canonical SourceItem/Node/File/Version/CAS checks are
// performed by checkLocalEvidenceCloudMetadata before AND after byte I/O.
func (s *Server) checkLocalQuarantinedEvidenceScope(
	c *gin.Context, sourceID, revision uint64, proof localSourceExecutorProof,
	input localEvidenceCloudMetadataRequest,
) error {
	if c == nil || c.Request == nil {
		return errLocalEvidenceConflict
	}
	return s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		return s.checkLocalQuarantinedEvidenceScopeTx(tx, c, sourceID, revision, proof, input)
	})
}

// checkLocalQuarantinedEvidenceScopeTx is the independently reusable, exact,
// transaction-scoped quarantine/evidence guard for a future L03-E1 writer.
// The caller must use the SAME authorized transaction for any metadata writes.
// Success is NEVER proof of durable physical CAS bytes or upload completion.
func (s *Server) checkLocalQuarantinedEvidenceScopeTx(
	tx *gorm.DB, c *gin.Context, sourceID, revision uint64,
	proof localSourceExecutorProof, input localEvidenceCloudMetadataRequest,
) error {
	if tx == nil || c == nil || c.Request == nil || sourceID == 0 || revision == 0 ||
		!validLocalQuarantinedContentClaims(input) {
		return errLocalEvidenceConflict
	}
	boundValue, exists := c.Get(localSourceExecutorContextKey)
	bound, authorized := boundValue.(localSourceExecutorProof)
	if !exists || !authorized || bound != proof {
		return errLocalSourceExecutorTransactionUnauthorized
	}

	ids := make([]uint64, len(input.Items))
	for i, item := range input.Items {
		ids[i] = item.EvidenceID
	}
	fingerprint := strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint")))
	// Match device -> Source -> Root ordering used by revocation and
	// mutations; never accept a JWT without owning-device credentials.
	if err := s.requireLocalSourceProofTx(tx, c, sourceID, "", false); err != nil {
		return err
	}
	var source meta.Source
	if err := tx.Select("id", "owner_id", "kind", "direction", "status", "revision").
		Where("id = ? AND owner_id = ?", sourceID, userID(c)).Take(&source).Error; err != nil {
		return err
	}
	if !isLocalFolderPush(source) {
		return errLocalBindingTypeInvalid
	}
	if source.Revision != revision || proof.SourceRevision != revision {
		return errRevisionConflict
	}
	if source.Status != meta.SourceStatusPaused {
		return errLocalBindingStateInvalid
	}

	var intents []meta.LocalSourceCommitIntent
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("source_id = ? AND source_revision = ? AND device_id = ? AND root_id = ? AND root_fingerprint = ?",
			sourceID, revision, proof.DeviceID, proof.RootID, fingerprint).
		Where("previous_snapshot_sha256 = ? AND current_snapshot_sha256 = ? AND state = ?",
			input.PreviousSnapshotSHA256, input.CurrentSnapshotSHA256,
			meta.LocalSourceCommitIntentStateQuarantined).
		Where("evidence_id IN ?", ids).
		Order("evidence_id ASC").Limit(localEvidencePhysicalCASLimitItems).
		Find(&intents).Error; err != nil {
		return err
	}
	if len(intents) != len(ids) {
		return errLocalEvidenceConflict
	}
	var evidence []meta.LocalSourceItemEvidence
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("source_id = ? AND source_revision = ? AND device_id = ? AND root_id = ? AND root_fingerprint = ?",
			sourceID, revision, proof.DeviceID, proof.RootID, fingerprint).
		Where("previous_snapshot_sha256 = ? AND current_snapshot_sha256 = ?",
			input.PreviousSnapshotSHA256, input.CurrentSnapshotSHA256).
		Where("id IN ?", ids).
		Order("id ASC").Limit(localEvidencePhysicalCASLimitItems).
		Find(&evidence).Error; err != nil {
		return err
	}
	if len(evidence) != len(ids) {
		return errLocalEvidenceConflict
	}
	for i, id := range ids {
		if intents[i].EvidenceID != id || evidence[i].ID != id ||
			!sameLocalQuarantinedEvidence(intents[i], evidence[i],
				sourceID, revision, proof, fingerprint) {
			return errLocalEvidenceConflict
		}
	}
	return c.Request.Context().Err()
}

// Owning-Agent-only point-in-time inspection of the SAME already quarantined
// 1–4 candidates and <=64MiB of their actual CAS bytes. The Server validates
// the quarantined relation and current cloud records on both sides of byte
// reads, rejecting revocation, source edits, evidence changes or replacement.
// No durable byte pin, canonical write, success token or activation is issued.
func (s *Server) preflightLocalQuarantinedContent(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return
	}
	raw, exists := c.Get(localSourceExecutorContextKey)
	proof, proofOK := raw.(localSourceExecutorProof)
	if !exists || !proofOK || proof.DeviceID == "" || proof.RootID == "" || proof.SourceRevision == 0 {
		fail(c, http.StatusForbidden, "owning device and Root required")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localEvidenceCloudMetadataMaxBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var input localEvidenceCloudMetadataRequest
	if err := decoder.Decode(&input); err != nil || !validLocalQuarantinedContentClaims(input) {
		fail(c, http.StatusBadRequest, "invalid bounded quarantine content check")
		return
	}
	var tail any
	if err := decoder.Decode(&tail); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "trailing quarantine content check")
		return
	}
	if s.Store == nil {
		fail(c, http.StatusServiceUnavailable, "physical content storage unavailable")
		return
	}
	readCtx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
	defer cancel()
	c.Request = c.Request.WithContext(readCtx)

	revision, objects, err := s.checkLocalQuarantinedCloudSnapshot(
		c, sourceID, expected, proof, input)
	if err != nil {
		failLocalEvidencePhysicalCAS(c, err, expected, revision)
		return
	}
	if len(objects) != len(input.Items) {
		fail(c, http.StatusConflict, "local quarantine content changed")
		return
	}
	for _, object := range objects {
		if err := verifyPhysicalEvidenceCAS(readCtx, s.Store, object); err != nil {
			if readCtx.Err() != nil {
				fail(c, http.StatusServiceUnavailable, "quarantine content check interrupted")
			} else {
				fail(c, http.StatusConflict, "physical content unavailable or changed")
			}
			return
		}
	}
	revisionAgain, objectsAgain, err := s.checkLocalQuarantinedCloudSnapshot(
		c, sourceID, expected, proof, input)
	if err != nil {
		failLocalEvidencePhysicalCAS(c, err, expected, revisionAgain)
		return
	}
	if revisionAgain != revision || len(objectsAgain) != len(objects) || readCtx.Err() != nil {
		fail(c, http.StatusConflict, "quarantine source changed during physical check")
		return
	}
	for i := range objects {
		if objectsAgain[i] != objects[i] {
			fail(c, http.StatusConflict, "quarantine content changed during physical check")
			return
		}
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localQuarantinedContentResponse{
		SourceID: sourceID, Revision: revision, Checked: len(input.Items),
		QuarantineMatched: true, PhysicalCASMatched: true,
		CloudBytesVerified: false, ContentVerified: false,
		CommitSupported: false, Authoritative: false, MissingInferenceSafe: false,
	})
}
