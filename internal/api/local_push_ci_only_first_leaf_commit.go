package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// This deliberately contains no native provenance or backup-complete claim.
// It is a CI-only transport contract for an existing UNROUTED SQL/CAS writer.
type ciOnlyFirstLeafCommitRequest struct {
	RelativeLeaf string `json:"relative_leaf"`
}

type ciOnlyFirstLeafCommitResponse struct {
	StageID              string `json:"stage_id"`
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	NodeID               uint64 `json:"node_id"`
	SourceItemID         uint64 `json:"source_item_id"`
	State                string `json:"state"`
	Replayed             bool   `json:"replayed"`
	CASObserved          bool   `json:"cas_observed"`
	NativeVerified       bool   `json:"native_verified"`
	BackupComplete       bool   `json:"backup_complete"`
	CommitSupported      bool   `json:"commit_supported"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

// ciOnlyCommitLocalPushFirstLeaf is not registered in a normal Server.Router.
// An UNEXPORTED, ZERO-default Server flag installs it in PostgreSQL/CAS tests
// only. It has NO env/setting/CLI/Agent/Renderer/Web enabling path.
//
// Even in CI, every POST has to pass owning device+Root middleware, exact
// Source revision, and the existing atomic physical CAS/SQL quota writer.
// An allowed result is a private first-leaf fact, not backup completion,
// native current-file attestation or permission to start a SourceRun.
func (s *Server) ciOnlyCommitLocalPushFirstLeaf(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	if !s.localPushCIOnlyFirstLeaf {
		fail(c, http.StatusNotFound, "local backup executor unavailable")
		return
	}
	sourceID, stageID, ok := localPushStagePath(c)
	if !ok {
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
	var req ciOnlyFirstLeafCommitRequest
	if err := decoder.Decode(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid bounded local commit input")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "trailing local commit input")
		return
	}
	// Reject alternate canonical names before canonical SQL writes, and
	// never put the sensitive relative filename in URL or error response.
	if _, err := localPushFirstLeafPathKey(proof.RootID, req.RelativeLeaf); err != nil {
		fail(c, http.StatusBadRequest, "invalid local first-leaf name")
		return
	}
	result, admitted, err := s.commitBoundLocalPushFirstLeaf(
		c, sourceID, revision, proof, stageID, req.RelativeLeaf,
	)
	if err != nil {
		failLocalPushStage(c, err)
		return
	}
	if !admitted || result.NodeID == 0 || result.SourceItemID == 0 {
		fail(c, http.StatusConflict, "local first-leaf commit unavailable")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	code := http.StatusCreated
	if result.Replayed {
		code = http.StatusOK
	}
	c.JSON(code, ciOnlyFirstLeafCommitResponse{
		StageID: stageID, SourceID: sourceID, Revision: revision,
		NodeID: result.NodeID, SourceItemID: result.SourceItemID,
		State:    localPushFirstLeafPhysicalReceiptState,
		Replayed: result.Replayed, CASObserved: true,
		NativeVerified: false, BackupComplete: false, CommitSupported: false,
		Authoritative: false, MissingInferenceSafe: false,
	})
}
