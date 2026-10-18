package api

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// This POST is READ ONLY. A Stage UUID may be in the URL (as for existing
// Staging reads), but the local leaf and original OS-private request key
// must NEVER be included in query strings or response/log fields.
type localPushOperationPhysicalReadRequest struct {
	RelativeLeaf string `json:"relative_leaf"`
	RequestKey   string `json:"request_key"`
	OperationID  string `json:"operation_id"`
	Generation   uint64 `json:"generation"`
}

// Always a nonauthoritative, owner+device-only historical read projection.
// No native Root, local path, key, digest or physical execution instruction.
type localPushOperationPhysicalReadResponse struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	StageID              string `json:"stage_id"`
	OperationID          string `json:"operation_id"`
	Generation           uint64 `json:"generation"`
	NodeID               uint64 `json:"node_id"`
	SourceItemID         uint64 `json:"source_item_id"`
	State                string `json:"state"`
	CASObserved          bool   `json:"cas_observed"`
	NativeVerified       bool   `json:"native_verified"`
	BackupComplete       bool   `json:"backup_complete"`
	CommitSupported      bool   `json:"commit_supported"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
	RetirementSupported  bool   `json:"retirement_supported"`
}

// This endpoint is READ ONLY and requires the existing authenticated owning
// device/Root middleware. SQL independently reauthenticates inside the held
// historical CAS read transaction. It is NOT an upload/finalize/cancel route.
func (s *Server) readLocalPushHistoricalOperationPhysical(c *gin.Context) {
	if c == nil {
		return
	}
	c.Header("Cache-Control", "private, no-store")
	if c.Request == nil || c.Request.URL == nil ||
		c.Request.Body == nil || c.Request.URL.RawQuery != "" {
		fail(c, http.StatusBadRequest, "invalid private operation physical read")
		return
	}
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "application/json" {
		fail(c, http.StatusBadRequest, "invalid private operation physical content type")
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
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 768)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var req localPushOperationPhysicalReadRequest
	if err := decoder.Decode(&req); err != nil ||
		!validLocalPushPrepareOperationUUID(req.OperationID) ||
		req.Generation == 0 {
		fail(c, http.StatusBadRequest, "invalid private operation physical selector")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "trailing private operation physical selector")
		return
	}
	key, valid := validLocalPushOperationPrepareKey(req.RequestKey)
	if !valid {
		fail(c, http.StatusBadRequest, "invalid private operation physical request key")
		return
	}
	if _, err := localPushFirstLeafPathKey(proof.RootID, req.RelativeLeaf); err != nil {
		fail(c, http.StatusBadRequest, "invalid private first-leaf selector")
		return
	}
	observed, err := s.observeBoundLocalPushHistoricalOperationPhysicalCommit(
		c, sourceID, revision, proof, stageID, req.RelativeLeaf,
		key, req.OperationID, req.Generation,
	)
	if err != nil || !observed.casObserved ||
		observed.operationID != req.OperationID ||
		observed.generation != req.Generation ||
		observed.stageID != stageID ||
		observed.nodeID == 0 || observed.sourceItemID == 0 {
		fail(c, http.StatusConflict, "private operation physical observation unavailable")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localPushOperationPhysicalReadResponse{
		SourceID: sourceID, Revision: revision, StageID: stageID,
		OperationID: observed.operationID, Generation: observed.generation,
		NodeID: observed.nodeID, SourceItemID: observed.sourceItemID,
		State:       localPushFirstLeafPhysicalReceiptState,
		CASObserved: true, NativeVerified: false, BackupComplete: false,
		CommitSupported: false, Authoritative: false,
		MissingInferenceSafe: false, RetirementSupported: false,
	})
}
