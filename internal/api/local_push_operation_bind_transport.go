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

const localPushOperationBindMaxBody = 512

// Private selector for one already-staged, device-owned original and the
// exact current durable Operation. It is NOT a writer/cancel/Run token.
type localPushOperationBindRequest struct {
	RequestKey  string `json:"request_key"`
	OperationID string `json:"operation_id"`
	Generation  uint64 `json:"generation"`
}

type localPushOperationBindResponse struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	StageID              string `json:"stage_id"`
	OperationID          string `json:"operation_id"`
	Generation           uint64 `json:"generation"`
	State                string `json:"state"`
	CommitSupported      bool   `json:"commit_supported"`
	BackupComplete       bool   `json:"backup_complete"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
	RetirementSupported  bool   `json:"retirement_supported"`
}

// bindLocalPushOperationStage publishes ONLY an immutable SQL correlation
// between a fully authenticated owning-Agent reservation and a previously
// staged physical first-file candidate. The bound claim has no run authority:
// no Node, Blob, SourceItem, SourceRun, file content, or native key retirement
// is written by this endpoint. Only the future held-native/SQL/CAS writer may
// consult this correlation within its own independent Server transaction.
func (s *Server) bindLocalPushOperationStage(c *gin.Context) {
	if c == nil {
		return
	}
	c.Header("Cache-Control", "private, no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "private local operation unavailable")
		return
	}
	if c.Request == nil || c.Request.URL == nil || c.Request.Body == nil || c.Request.URL.RawQuery != "" {
		fail(c, http.StatusBadRequest, "invalid private operation bind request")
		return
	}
	kind, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || kind != "application/json" {
		fail(c, http.StatusBadRequest, "invalid private operation bind content type")
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
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localPushOperationBindMaxBody)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var req localPushOperationBindRequest
	if err := decoder.Decode(&req); err != nil ||
		!validLocalPushPrepareOperationUUID(req.OperationID) || req.Generation == 0 {
		fail(c, http.StatusBadRequest, "invalid private operation selector")
		return
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "trailing private operation selector")
		return
	}
	key, valid := validLocalPushOperationPrepareKey(req.RequestKey)
	if !valid {
		fail(c, http.StatusBadRequest, "invalid private operation key")
		return
	}
	result, err := s.bindBoundLocalPushOperationStage(
		c, sourceID, revision, proof, stageID, key, req.OperationID, req.Generation,
	)
	if err != nil || result.StageID != stageID || result.SourceID != sourceID ||
		result.OperationID != req.OperationID || result.Generation != req.Generation ||
		result.SourceRevision != revision || result.BoundAt.IsZero() {
		fail(c, http.StatusConflict, "private operation bind unavailable")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localPushOperationBindResponse{
		SourceID: sourceID, Revision: revision, StageID: stageID,
		OperationID: req.OperationID, Generation: req.Generation, State: "bound",
		CommitSupported: false, BackupComplete: false, Authoritative: false,
		MissingInferenceSafe: false, RetirementSupported: false,
	})
}
