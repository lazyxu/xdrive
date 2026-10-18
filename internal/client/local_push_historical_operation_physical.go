package client

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// A private, transient historical SQL+CAS observation. Its values are
// deliberately excluded from IPC/JSON; no uploader or executor consumes it.
// It does NOT attest current native file contents or durable cancellation.
type LocalPushHistoricalOperationPhysicalReceipt struct {
	StageID             string `json:"-"`
	SourceID            uint64 `json:"-"`
	Revision            uint64 `json:"-"`
	OperationID         string `json:"-"`
	Generation          uint64 `json:"-"`
	NodeID              uint64 `json:"-"`
	SourceItemID        uint64 `json:"-"`
	CASObserved         bool   `json:"-"`
	BackupComplete      bool   `json:"-"`
	NativeVerified      bool   `json:"-"`
	CommitSupported     bool   `json:"-"`
	Authoritative       bool   `json:"-"`
	RetirementSupported bool   `json:"-"`
}

const localPushHistoricalOperationPhysicalMaxReply = 2048

// ReadLocalPushHistoricalOperationPhysicalReceipt is a READ-ONLY recovery
// operation for an enrolled owning Agent. Only the original private 32-byte
// key may select a historical first-leaf COMMIT, not a copied digest.
// This does not grant upload, Runner, SourceRun or OS key retirement rights.
func (c *Client) ReadLocalPushHistoricalOperationPhysicalReceipt(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	stageID, relativeLeaf string, originalKey [32]byte, operationID string,
	generation uint64,
) (LocalPushHistoricalOperationPhysicalReceipt, error) {
	var empty LocalPushHistoricalOperationPhysicalReceipt
	stage, stageErr := uuid.Parse(stageID)
	op, opErr := uuid.Parse(operationID)
	var nonzero byte
	for _, b := range originalKey {
		nonzero |= b
	}
	if !validLocalPushStageProof(ctx, sourceID, revision, proof) ||
		stageErr != nil || stage.String() != stageID ||
		opErr != nil || op.String() != operationID ||
		generation == 0 || nonzero == 0 || relativeLeaf == "" ||
		len(relativeLeaf) > 255 || relativeLeaf == "." ||
		relativeLeaf == ".." || strings.TrimSpace(relativeLeaf) != relativeLeaf ||
		strings.ContainsAny(relativeLeaf, "/\\") {
		return empty, errors.New("invalid private local physical operation")
	}
	payload, err := json.Marshal(struct {
		RelativeLeaf string `json:"relative_leaf"`
		RequestKey   string `json:"request_key"`
		OperationID  string `json:"operation_id"`
		Generation   uint64 `json:"generation"`
	}{
		RelativeLeaf: relativeLeaf,
		RequestKey:   base64.RawURLEncoding.EncodeToString(originalKey[:]),
		OperationID:  operationID, Generation: generation,
	})
	if err != nil {
		return empty, errors.New("private operation physical read unavailable")
	}
	req, err := c.request(ctx, http.MethodPost,
		localPushStagingURL(sourceID, stageID)+"/operation-physical-receipt",
		bytes.NewReader(payload))
	if err != nil {
		return empty, err
	}
	req.Header.Set("Content-Type", "application/json")
	localPushStageRequestHeaders(req, revision, proof)
	resp, err := c.do(req)
	if err != nil {
		return empty, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return empty, responseError(resp)
	}
	cache := strings.ToLower(resp.Header.Get("Cache-Control"))
	if resp.Header.Get("ETag") != strconv.Quote(strconv.FormatUint(revision, 10)) ||
		!strings.Contains(cache, "private") || !strings.Contains(cache, "no-store") {
		return empty, errors.New("cacheable or revision-unfenced operation physical receipt")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, localPushHistoricalOperationPhysicalMaxReply+1))
	if err != nil || len(raw) > localPushHistoricalOperationPhysicalMaxReply {
		return empty, errors.New("oversized private historical receipt")
	}
	var got struct {
		SourceID             uint64 `json:"source_id"`
		Revision             uint64 `json:"revision"`
		StageID              string `json:"stage_id"`
		OperationID          string `json:"operation_id"`
		Generation           uint64 `json:"generation"`
		NodeID               uint64 `json:"node_id"`
		SourceItemID         uint64 `json:"source_item_id"`
		State                string `json:"state"`
		CASObserved          *bool  `json:"cas_observed"`
		NativeVerified       *bool  `json:"native_verified"`
		BackupComplete       *bool  `json:"backup_complete"`
		CommitSupported      *bool  `json:"commit_supported"`
		Authoritative        *bool  `json:"authoritative"`
		MissingInferenceSafe *bool  `json:"missing_inference_safe"`
		RetirementSupported  *bool  `json:"retirement_supported"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&got); err != nil {
		return empty, errors.New("invalid private historical operation receipt")
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return empty, errors.New("trailing historical operation receipt")
	}
	if got.SourceID != sourceID || got.Revision != revision ||
		got.StageID != stageID || got.OperationID != operationID ||
		got.Generation != generation || got.NodeID == 0 || got.SourceItemID == 0 ||
		got.State != localPushPhysicalReceiptOnly ||
		got.CASObserved == nil || !*got.CASObserved ||
		got.NativeVerified == nil || *got.NativeVerified ||
		got.BackupComplete == nil || *got.BackupComplete ||
		got.CommitSupported == nil || *got.CommitSupported ||
		got.Authoritative == nil || *got.Authoritative ||
		got.MissingInferenceSafe == nil || *got.MissingInferenceSafe ||
		got.RetirementSupported == nil || *got.RetirementSupported ||
		ctx.Err() != nil {
		return empty, fmt.Errorf("unsafe private historical operation physical receipt")
	}
	return LocalPushHistoricalOperationPhysicalReceipt{
		StageID: stageID, SourceID: sourceID, Revision: revision,
		OperationID: operationID, Generation: generation,
		NodeID: got.NodeID, SourceItemID: got.SourceItemID, CASObserved: true,
	}, nil
}
