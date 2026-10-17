package api

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

const localPushOperationPrepareMaxBody = 256

// localPushOperationPrepareRequest is an authenticated owning-device transport
// selector, NOT proof of the native OS handle or authorization to upload.
type localPushOperationPrepareRequest struct {
	RequestKey string `json:"request_key"`
}

// Operation ID and generation identify only the Server-private reservation.
// No key, absolute path, Root, credential, content digest, or upload ticket
// is returned. Explicitly false safety flags prevent a positive-looking
// reservation from being reported as a backed-up SourceRun or file.
type localPushOperationPrepareResponse struct {
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

func validLocalPushOperationPrepareKey(value string) ([]byte, bool) {
	// Strict, canonical, unpadded base64url encoding: exactly 32 bytes.
	if len(value) != 43 {
		return nil, false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(decoded) != localPushOperationRequestKeySize ||
		base64.RawURLEncoding.EncodeToString(decoded) != value {
		return nil, false
	}
	var nonzero byte
	for _, v := range decoded {
		nonzero |= v
	}
	return decoded, nonzero != 0
}

func validLocalPushPrepareOperationUUID(value string) bool {
	parsed, err := uuid.Parse(value)
	return err == nil && parsed.String() == value
}

// prepareLocalPushOperation is credential-and-Root bound but deliberately
// DOES NOT authorize Source activation, SourceRun, CAS writes, uploading, or
// Mirror deletion. Replaying the exact live key returns the same operation.
// Web / foreign Desktop cannot use an owner JWT alone to pass the middleware.
func (s *Server) prepareLocalPushOperation(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	if c.Request == nil || c.Request.URL == nil || c.Request.URL.RawQuery != "" {
		fail(c, http.StatusBadRequest, "invalid private local operation request")
		return
	}
	contentType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || contentType != "application/json" {
		fail(c, http.StatusBadRequest, "invalid private local operation content type")
		return
	}
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return
	}
	if _, ok := localPushStageProof(c); !ok {
		fail(c, http.StatusForbidden, "owning device credential and Root required")
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localPushOperationPrepareMaxBody)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var req localPushOperationPrepareRequest
	if err := decoder.Decode(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid private local operation input")
		return
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "unexpected private local operation input")
		return
	}
	key, valid := validLocalPushOperationPrepareKey(req.RequestKey)
	if !valid {
		fail(c, http.StatusBadRequest, "invalid private local operation key")
		return
	}
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "private local operation unavailable")
		return
	}
	intent, err := s.reserveBoundLocalPushOperationIntentWithKey(c, sourceID, revision, key)
	if err != nil || intent.ID == "" || intent.SourceID != sourceID ||
		intent.SourceRevision != revision || intent.Generation == 0 ||
		intent.State != meta.LocalPushOperationIntentReserved ||
		!validLocalPushPrepareOperationUUID(intent.ID) {
		fail(c, http.StatusConflict, "private local operation unavailable")
		return
	}
	// Always HTTP 200: a first accepted request and a replay are the same
	// durable reservation, not distinct successful backup operations.
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localPushOperationPrepareResponse{
		SourceID: sourceID, Revision: revision,
		OperationID: intent.ID, Generation: intent.Generation,
		State:           meta.LocalPushOperationIntentReserved,
		CommitSupported: false, BackupComplete: false,
		Authoritative: false, MissingInferenceSafe: false,
	})
}
