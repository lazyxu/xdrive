package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// A body instead of a path/query parameter prevents local file names from
// entering URL logs and link previews. This request never grants a write.
type localPushFirstLeafReceiptReadRequest struct {
	RelativeLeaf string `json:"relative_leaf"`
}

// Deliberately redacted: NO local Root/path, device token, CAS storage key,
// SHA256, mutable Source data, and especially no backup success claim.
type localPushFirstLeafPhysicalReceiptReadDTO struct {
	StageID              string `json:"stage_id"`
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	NodeID               uint64 `json:"node_id"`
	SourceItemID         uint64 `json:"source_item_id"`
	State                string `json:"state"`
	CASObserved          bool   `json:"cas_observed"`
	NativeVerified       bool   `json:"native_verified"`
	BackupComplete       bool   `json:"backup_complete"`
	CommitSupported      bool   `json:"commit_supported"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

// readLocalPushFirstLeafCommittedPhysicalReceipt is a strictly device-bound
// READ-ONLY lost-reply recovery lookup. It may recover a PRIVATE SQL/physical
// CAS fact AFTER its temporary Stage expires or is replaced, but it CANNOT
// authenticate the native source's present bytes, turn a PENDING SourceItem
// into synced, resume a Stage or start/finish a backup.
//
// requireLocalSourceExecutor() also checks the user/Source/device/Root/secret
// before entering this handler. The SQL + pinned physical-CAS check below
// REPEATS those proofs under the same PostgreSQL transaction.
func (s *Server) readLocalPushFirstLeafCommittedPhysicalReceipt(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, stageID, ok := localPushStagePath(c)
	if !ok {
		return
	}
	proof, ok := localPushStageProof(c)
	if !ok {
		fail(c, http.StatusForbidden, "owning device authorization required")
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
	var request localPushFirstLeafReceiptReadRequest
	if err := decoder.Decode(&request); err != nil {
		fail(c, http.StatusBadRequest, "invalid local physical receipt request")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "trailing local physical receipt input")
		return
	}
	// Validating the leaf is NOT proof that the file exists. Its immutable
	// Root-scoped hash must match the historical Stage intent in SQL.
	if _, err := localPushFirstLeafPathKey(proof.RootID, request.RelativeLeaf); err != nil {
		fail(c, http.StatusBadRequest, "invalid local physical receipt leaf")
		return
	}
	receipt, err := s.readBoundLocalPushFirstLeafPhysicalReceipt(
		c, sourceID, revision, proof, stageID, request.RelativeLeaf,
	)
	if err != nil {
		failLocalPushStage(c, err)
		return
	}
	if receipt.State != localPushFirstLeafPhysicalReceiptState ||
		receipt.NodeID == 0 || receipt.SourceItemID == 0 {
		fail(c, http.StatusConflict, "local physical receipt unavailable")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localPushFirstLeafPhysicalReceiptReadDTO{
		StageID: stageID, SourceID: sourceID, Revision: revision,
		NodeID: receipt.NodeID, SourceItemID: receipt.SourceItemID,
		State:       localPushFirstLeafPhysicalReceiptState,
		CASObserved: true, NativeVerified: false, BackupComplete: false,
		CommitSupported: false, Authoritative: false, MissingInferenceSafe: false,
	})
}
