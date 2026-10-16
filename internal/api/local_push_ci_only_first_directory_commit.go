package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

// ciOnlyFirstDirectoryCommitRequest contains a selector, NOT native filesystem
// evidence or authority to execute a backup. The production Router omits it.
type ciOnlyFirstDirectoryCommitRequest struct {
	RelativeDirectory string `json:"relative_directory"`
}

type ciOnlyFirstDirectoryCommitResponse struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	NodeID               uint64 `json:"node_id"`
	SourceItemID         uint64 `json:"source_item_id"`
	State                string `json:"state"`
	Replayed             bool   `json:"replayed"`
	NativeVerified       bool   `json:"native_verified"`
	BackupComplete       bool   `json:"backup_complete"`
	CommitSupported      bool   `json:"commit_supported"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

// ciOnlyCommitLocalPushFirstDirectory is reachable ONLY from a test Router
// whose unexported zero-default flag was set directly by the api Go fixture.
// There is no environment/config/admin/UI/Agent switch for this route.
// A test result remains PENDING, without verified native directory provenance,
// FileVersion, SourceRun, CAS bytes, successful backup or deletion authority.
func (s *Server) ciOnlyCommitLocalPushFirstDirectory(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	if !s.localPushCIOnlyFirstDirectory {
		fail(c, http.StatusNotFound, "local backup executor unavailable")
		return
	}
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return
	}
	proof, ok := localPushStageProof(c)
	if !ok {
		fail(c, http.StatusForbidden, "owning device proof required")
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	if proof.SourceRevision != revision {
		fail(c, http.StatusConflict, "local Source revision changed")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var req ciOnlyFirstDirectoryCommitRequest
	if err := decoder.Decode(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid bounded local directory input")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "trailing local directory input")
		return
	}
	if _, err := localPushFirstDirectoryPathKey(proof.RootID, req.RelativeDirectory); err != nil {
		fail(c, http.StatusBadRequest, "invalid local directory component")
		return
	}
	result, admitted, err := s.commitBoundLocalPushFirstDirectory(
		c, sourceID, revision, proof, req.RelativeDirectory,
	)
	if err != nil {
		failLocalPushStage(c, err)
		return
	}
	if !admitted || result.NodeID == 0 || result.SourceItemID == 0 {
		fail(c, http.StatusConflict, "private first-directory commit unavailable")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	code := http.StatusCreated
	if result.Replayed {
		code = http.StatusOK
	}
	c.JSON(code, ciOnlyFirstDirectoryCommitResponse{
		SourceID: sourceID, Revision: revision,
		NodeID: result.NodeID, SourceItemID: result.SourceItemID,
		State: meta.SourceItemStatePending, Replayed: result.Replayed,
		NativeVerified: false, BackupComplete: false,
		CommitSupported: false, Authoritative: false,
		MissingInferenceSafe: false,
	})
}
