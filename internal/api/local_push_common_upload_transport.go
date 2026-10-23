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

const localPushCommonUploadMaxBody = 1024

type localPushCommonOperationDTO struct {
	SourceID       uint64 `json:"source_id"`
	Revision       uint64 `json:"revision"`
	OperationID    string `json:"operation_id"`
	State          string `json:"state"`
	BackupComplete bool   `json:"backup_complete"`
	RetirementSafe bool   `json:"retirement_safe"`
}

func decodePrivateLocalCommonUpload(c *gin.Context, into any) bool {
	if c == nil || c.Request == nil || c.Request.URL == nil ||
		c.Request.Body == nil || c.Request.URL.RawQuery != "" {
		return false
	}
	kind, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || kind != "application/json" {
		return false
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localPushCommonUploadMaxBody)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(into); err != nil {
		return false
	}
	var trailing any
	return errors.Is(decoder.Decode(&trailing), io.EOF)
}

// This endpoint is callable only after JWT + requireLocalSourceExecutor.
// Admission does not create a generic Session, CAS, Node, FileVersion or
// SourceRun and must not be treated as authority for old Stage/key retirement.
func (s *Server) admitLocalPushCommonUpload(c *gin.Context) {
	if c == nil {
		return
	}
	c.Header("Cache-Control", "private, no-store")
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source")
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	var input localPushCommonAdmitRequest
	if !decodePrivateLocalCommonUpload(c, &input) {
		fail(c, http.StatusBadRequest, "invalid private file operation")
		return
	}
	op, err := s.admitBoundLocalPushCommonUpload(c, sourceID, revision, input)
	if err != nil || op.OperationID != input.OperationID ||
		op.State != meta.LocalPushCommonUploadReserved &&
			op.State != meta.LocalPushCommonUploadBound &&
			op.State != meta.LocalPushCommonUploadCommitted {
		fail(c, http.StatusConflict, "private file operation unavailable")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localPushCommonOperationDTO{
		SourceID: sourceID, Revision: revision, OperationID: op.OperationID,
		State: op.State, BackupComplete: false, RetirementSafe: false,
	})
}

// Bind only correlates an immutable owning-device Operation with an
// already-created ordinary Owner UploadSession. Actual bytes and NodeVersion
// are committed solely by the existing generic /uploads/:id/finalize.
func (s *Server) bindLocalPushCommonUpload(c *gin.Context) {
	if c == nil {
		return
	}
	c.Header("Cache-Control", "private, no-store")
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source")
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	var input localPushCommonBindRequest
	if !decodePrivateLocalCommonUpload(c, &input) {
		fail(c, http.StatusBadRequest, "invalid private file binding")
		return
	}
	op, err := s.bindBoundLocalPushCommonUpload(c, sourceID, revision, input)
	if err != nil || op.OperationID != input.OperationID ||
		op.State != meta.LocalPushCommonUploadBound ||
		op.UploadSessionID == nil || *op.UploadSessionID != input.UploadSessionID {
		fail(c, http.StatusConflict, "private file binding unavailable")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localPushCommonOperationDTO{
		SourceID: sourceID, Revision: revision, OperationID: op.OperationID,
		State: op.State, BackupComplete: false, RetirementSafe: false,
	})
}
