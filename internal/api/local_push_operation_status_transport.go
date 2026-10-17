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
)

const localPushOperationStatusMaxBody = 256

// Route-specific privacy guard runs BEFORE owning-device authorization, so
// even a 403/404 issued by the executor middleware is non-cacheable.
// The broader JWT middleware still owns unauthenticated rejection.
func localPushOperationNoStore(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Next()
}

// A private, exact-UUID-and-generation selector; neither field is an
// authorization credential. Source, Root and owning Device are rechecked
// independently on every request and again inside the SQL transaction.
type localPushOperationStatusRequest struct {
	OperationID string `json:"operation_id"`
	Generation  uint64 `json:"generation"`
}

// These statuses are only observations of the latest durable reservation,
// NOT proof of original file bytes, upload activity or SourceRun completion.
type localPushOperationStatusResponse struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	OperationID          string `json:"operation_id"`
	Generation           uint64 `json:"generation"`
	State                string `json:"state"`
	CommitSupported      bool   `json:"commit_supported"`
	BackupComplete       bool   `json:"backup_complete"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

func readLocalPushOperationStatusRequest(c *gin.Context) (uint64, uint64, localPushOperationStatusRequest, bool) {
	var zero localPushOperationStatusRequest
	if c == nil || c.Request == nil || c.Request.URL == nil || c.Request.Body == nil ||
		c.Request.URL.RawQuery != "" {
		fail(c, http.StatusBadRequest, "invalid private local operation request")
		return 0, 0, zero, false
	}
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "application/json" {
		fail(c, http.StatusBadRequest, "invalid private local operation content type")
		return 0, 0, zero, false
	}
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return 0, 0, zero, false
	}
	if _, ok := localPushStageProof(c); !ok {
		fail(c, http.StatusForbidden, "owning local device and Root required")
		return 0, 0, zero, false
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return 0, 0, zero, false
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localPushOperationStatusMaxBody)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var selector localPushOperationStatusRequest
	if err := decoder.Decode(&selector); err != nil ||
		!validLocalPushPrepareOperationUUID(selector.OperationID) || selector.Generation == 0 {
		fail(c, http.StatusBadRequest, "invalid private operation selector")
		return 0, 0, zero, false
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "unexpected private operation input")
		return 0, 0, zero, false
	}
	return sourceID, revision, selector, true
}

func writeLocalPushOperationStatus(c *gin.Context, sourceID, revision uint64, selector localPushOperationStatusRequest, state string) {
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localPushOperationStatusResponse{
		SourceID: sourceID, Revision: revision,
		OperationID: selector.OperationID, Generation: selector.Generation,
		State: state, CommitSupported: false, BackupComplete: false,
		Authoritative: false, MissingInferenceSafe: false,
	})
}

// POST rather than GET: operation selectors never appear in URLs, proxies,
// access logs, caches or generic device-backup read models.
func (s *Server) observeLocalPushOperation(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, revision, selector, ok := readLocalPushOperationStatusRequest(c)
	if !ok {
		return
	}
	observed, err := s.observeBoundLocalPushOperationIntent(
		c, sourceID, revision, selector.OperationID, selector.Generation)
	if err != nil || observed.generation != selector.Generation ||
		(observed.state != meta.LocalPushOperationIntentReserved &&
			observed.state != meta.LocalPushOperationIntentAborted &&
			observed.state != localPushOperationIntentObservedExpired) {
		fail(c, http.StatusConflict, "private local operation unavailable")
		return
	}
	writeLocalPushOperationStatus(c, sourceID, revision, selector, observed.state)
}

// Abort only changes the latest 30-second private reservation. It never
// cancels a real transfer, SourceRun, native OS handle or committed bytes.
// The underlying write repeats Owner -> Device -> Source -> Root SQL locking.
func (s *Server) abortLocalPushOperation(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, revision, selector, ok := readLocalPushOperationStatusRequest(c)
	if !ok {
		return
	}
	if err := s.abortBoundLocalPushOperationIntent(
		c, sourceID, revision, selector.OperationID, selector.Generation); err != nil {
		fail(c, http.StatusConflict, "private local operation unavailable")
		return
	}
	writeLocalPushOperationStatus(c, sourceID, revision, selector, meta.LocalPushOperationIntentAborted)
}
