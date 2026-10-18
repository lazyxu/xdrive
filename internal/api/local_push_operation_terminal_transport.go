package api

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

const localPushTerminalProofMaxBody = 384

// This selector must come from an owning Agent holding the original OS-private
// 32-byte request key. It is not an upload token or proof of physical bytes.
type localPushTerminalProofRequest struct {
	RequestKey  string `json:"request_key"`
	OperationID string `json:"operation_id"`
	Generation  uint64 `json:"generation"`
}

// A reservation terminal reply, never a file completion/cancel receipt.
type localPushTerminalProofResponse struct {
	SourceID             uint64    `json:"source_id"`
	Revision             uint64    `json:"revision"`
	OperationID          string    `json:"operation_id"`
	Generation           uint64    `json:"generation"`
	State                string    `json:"state"`
	RecordedAt           time.Time `json:"recorded_at"`
	CommitSupported      bool      `json:"commit_supported"`
	BackupComplete       bool      `json:"backup_complete"`
	Authoritative        bool      `json:"authoritative"`
	MissingInferenceSafe bool      `json:"missing_inference_safe"`
	RetirementSupported  bool      `json:"retirement_supported"`
}

// materializeLocalPushTerminalProof is a narrow POST-only device/Root-protected
// protocol, not a generic Source or remote Web API. requireLocalSourceExecutor
// and SQL-owning-scope checks independently fence every call. A terminal lease
// receipt is NOT authority to upload, delete or release the original key.
func (s *Server) materializeLocalPushTerminalProof(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	if c.Request == nil || c.Request.URL == nil || c.Request.Body == nil ||
		c.Request.URL.RawQuery != "" {
		fail(c, http.StatusBadRequest, "invalid private local terminal request")
		return
	}
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "application/json" {
		fail(c, http.StatusBadRequest, "invalid private local terminal content type")
		return
	}
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return
	}
	if _, ok := localPushStageProof(c); !ok {
		fail(c, http.StatusForbidden, "owning device and Root required")
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localPushTerminalProofMaxBody)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var selector localPushTerminalProofRequest
	if err := decoder.Decode(&selector); err != nil ||
		!validLocalPushPrepareOperationUUID(selector.OperationID) ||
		selector.Generation == 0 {
		fail(c, http.StatusBadRequest, "invalid private terminal selector")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "unexpected private terminal selector")
		return
	}
	key, valid := validLocalPushOperationPrepareKey(selector.RequestKey)
	if !valid {
		fail(c, http.StatusBadRequest, "invalid private local request key")
		return
	}
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "private local terminal unavailable")
		return
	}
	receipt, err := s.recordBoundLocalPushReservationTerminal(
		c, sourceID, revision, key, selector.OperationID, selector.Generation)
	if err != nil || receipt.operationID != selector.OperationID ||
		receipt.generation != selector.Generation ||
		(receipt.state != meta.LocalPushTerminalReservationAborted &&
			receipt.state != meta.LocalPushTerminalReservationExpired) ||
		receipt.recordedAt.IsZero() {
		fail(c, http.StatusConflict, "private local terminal unavailable")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localPushTerminalProofResponse{
		SourceID: sourceID, Revision: revision,
		OperationID: receipt.operationID, Generation: receipt.generation,
		State: receipt.state, RecordedAt: receipt.recordedAt.UTC(),
		CommitSupported: false, BackupComplete: false,
		Authoritative: false, MissingInferenceSafe: false,
		RetirementSupported: false,
	})
}
