package api

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const localPushFirstLeafOperationCommitMaxBody = 768
const localPushFirstLeafPendingNative = "first_leaf_committed_pending_native_confirmation"

// This is an owning-Agent-only, single NEW leaf canonical-byte commit selector.
// A valid temporary Stage and an exact current immutable Operation→Stage binding
// must already exist. Original OS paths, source secrets and request keys never
// appear in URLs, response JSON or logs.
type localPushFirstLeafOperationCommitRequest struct {
	RelativeLeaf string `json:"relative_leaf"`
	RequestKey   string `json:"request_key"`
	OperationID  string `json:"operation_id"`
	Generation   uint64 `json:"generation"`
}

// Node and SourceItem are PENDING metadata only. This receipt is not a
// SourceRun or durable native-file content attestation. ACK loss after SQL
// COMMIT is ambiguous: callers MUST use the original keyed historical
// SQL/CAS read and native held-original recheck, never create a new key.
type localPushFirstLeafOperationCommitResponse struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	StageID              string `json:"stage_id"`
	OperationID          string `json:"operation_id"`
	Generation           uint64 `json:"generation"`
	NodeID               uint64 `json:"node_id"`
	SourceItemID         uint64 `json:"source_item_id"`
	State                string `json:"state"`
	Replayed             bool   `json:"replayed"`
	SQLCommitted         bool   `json:"sql_committed"`
	CASObserved          bool   `json:"cas_observed"`
	NativeVerified       bool   `json:"native_verified"`
	BackupComplete       bool   `json:"backup_complete"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
	RetirementSupported  bool   `json:"retirement_supported"`
}

// commitLocalPushFirstLeafOperation exposes exactly the pre-existing
// operation-fenced private physical CAS/SQL writer, NOT the unsafe legacy
// CI-only writer. All actual authorization and commit-vs-abort checks occur
// again under the writer's original SQL locks; this HTTP gate cannot bypass
// them. No scheduler, SourceRun, Mirror action or foreign-device control.
func (s *Server) commitLocalPushFirstLeafOperation(c *gin.Context) {
	if c == nil {
		return
	}
	c.Header("Cache-Control", "private, no-store")
	if s == nil || s.DB == nil || s.Store == nil ||
		c.Request == nil || c.Request.URL == nil ||
		c.Request.Body == nil || c.Request.URL.RawQuery != "" {
		fail(c, http.StatusBadRequest, "private first leaf commit unavailable")
		return
	}
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "application/json" {
		fail(c, http.StatusBadRequest, "invalid first leaf commit content type")
		return
	}
	sourceID, stageID, ok := localPushStagePath(c)
	if !ok {
		return
	}
	proof, ok := localPushStageProof(c)
	if !ok {
		fail(c, http.StatusForbidden, "owning device Root required")
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	if revision != proof.SourceRevision {
		fail(c, http.StatusConflict, "local Source revision changed")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localPushFirstLeafOperationCommitMaxBody)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var req localPushFirstLeafOperationCommitRequest
	if err := decoder.Decode(&req); err != nil ||
		!validLocalPushPrepareOperationUUID(req.OperationID) ||
		req.Generation == 0 {
		fail(c, http.StatusBadRequest, "invalid first leaf commit selector")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "trailing first leaf commit input")
		return
	}
	key, valid := validLocalPushOperationPrepareKey(req.RequestKey)
	if !valid {
		fail(c, http.StatusBadRequest, "invalid private operation key")
		return
	}
	pathKey, err := localPushFirstLeafPathKey(proof.RootID, req.RelativeLeaf)
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid first leaf name")
		return
	}
	// Early bounded NO-WRITE admission. The same current Operation, Source,
	// Root and immutable original request key are independently checked again
	// during the final CAS/SQL writer's held transaction. This preflight is
	// deliberately not a durable or native-file authorization token.
	var stageStatus string
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := s.validateCurrentLocalPushWriterFenceTx(
			tx, c, sourceID, revision, key, req.OperationID, req.Generation,
		); err != nil {
			return err
		}
		stage, err := s.loadLocalPushStageTx(tx, c, sourceID, revision, proof, stageID)
		if err != nil || stage.CurrentPathKey != pathKey ||
			(stage.Status != localPushStageReady && stage.Status != localPushStageCommitted) {
			return errLocalPushStageConflict
		}
		// The first physical production lane is Backup-only. Mirror still
		// needs trustworthy multi-scan deletion proof, trash and grace-period
		// semantics. No SourceRun or scheduler is activated by this commit.
		var source meta.Source
		if err := tx.Where("id = ?", sourceID).Take(&source).Error; err != nil ||
			source.SyncMode != meta.SourceSyncModeBackup ||
			source.Status != meta.SourceStatusPaused ||
			source.Revision != revision {
			return errLocalPushStageConflict
		}
		stageStatus = stage.Status
		return c.Request.Context().Err()
	})
	if err != nil {
		fail(c, http.StatusConflict, "private first leaf admission unavailable")
		return
	}
	if stageStatus == localPushStageReady {
		// Make the existing INTERNAL physical CAS prerequisites callable only
		// through this SAME owning-Agent, key+generation-fenced HTTP operation.
		// Each prerequisite independently reauthenticates in its OWN transaction
		// with the established SQL→nonblocking OS shard ordering. Partial work
		// is quarantined and never reported as a complete backup.
		if _, err := s.quarantineBoundLocalPushCASPrepareIntent(
			c, sourceID, revision, proof, stageID,
		); err != nil {
			failLocalPushStage(c, err)
			return
		}
		if physicallyPrepared, err := s.prepareQuarantinedBoundLocalPushNewCAS(
			c, sourceID, revision, proof, stageID,
		); err != nil || !physicallyPrepared {
			fail(c, http.StatusConflict, "private first leaf CAS preparation unavailable")
			return
		}
		if _, err := s.reserveBoundLocalPushQuota(
			c, sourceID, revision, proof, stageID,
		); err != nil {
			failLocalPushStage(c, err)
			return
		}
		if _, err := s.bindBoundLocalPushOperationStage(
			c, sourceID, revision, proof, stageID,
			key, req.OperationID, req.Generation,
		); err != nil {
			fail(c, http.StatusConflict, "private first leaf operation binding unavailable")
			return
		}
	}
	// For a previously COMMITTED Stage, only the exact historical SQL-backed
	// idempotent replay of the SAME operation is permitted. Never allocate
	// another Stage, quota hold, request key or operation generation.
	result, admitted, err := s.commitBoundLocalPushFirstLeafWithCurrentOperation(
		c, sourceID, revision, proof, stageID, req.RelativeLeaf,
		key, req.OperationID, req.Generation,
	)
	if err != nil {
		failLocalPushStage(c, err)
		return
	}
	if !admitted || result.NodeID == 0 || result.SourceItemID == 0 {
		fail(c, http.StatusConflict, "private first leaf commit unavailable")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	status := http.StatusCreated
	if result.Replayed {
		status = http.StatusOK
	}
	c.JSON(status, localPushFirstLeafOperationCommitResponse{
		SourceID: sourceID, Revision: revision, StageID: stageID,
		OperationID: req.OperationID, Generation: req.Generation,
		NodeID: result.NodeID, SourceItemID: result.SourceItemID,
		State: localPushFirstLeafPendingNative, Replayed: result.Replayed,
		SQLCommitted: true, CASObserved: true,
		NativeVerified: false, BackupComplete: false,
		Authoritative: false, MissingInferenceSafe: false,
		RetirementSupported: false,
	})
}
