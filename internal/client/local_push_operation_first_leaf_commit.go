package client

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

const localPushFirstLeafOperationCommitMaxReply = 1536
const localPushFirstLeafPendingNativeState = "first_leaf_committed_pending_native_confirmation"

// LocalPushFirstLeafCanonicalReceipt is an Agent-only PENDING first-file
// receipt. No field may be serialized to Renderer IPC or Web. Never infer
// a completed SourceRun, safe cancel or native-key retirement from this.
type LocalPushFirstLeafCanonicalReceipt struct {
	SourceID     uint64 `json:"-"`
	Revision     uint64 `json:"-"`
	StageID      string `json:"-"`
	OperationID  string `json:"-"`
	Generation   uint64 `json:"-"`
	NodeID       uint64 `json:"-"`
	SourceItemID uint64 `json:"-"`
	Replayed     bool   `json:"-"`
}

// CommitLocalPushFirstLeafWithOperation invokes ONLY the preexisting
// operation-fenced CAS/SQL first-leaf writer through an authenticated owning
// Agent transport. It needs an already physically staged and SQL-bound
// operation. A successful HTTP ACK still requires a fresh historical SQL/CAS
// and independently native-held original confirmation in the future Driver.
func (c *Client) CommitLocalPushFirstLeafWithOperation(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	stageID, relativeLeaf string, originalKey [32]byte, operationID string,
	generation uint64,
) (LocalPushFirstLeafCanonicalReceipt, error) {
	var empty LocalPushFirstLeafCanonicalReceipt
	if ctx == nil || c == nil {
		return empty, errors.New("invalid private local first leaf scope")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	stage, stageErr := uuid.Parse(stageID)
	operation, operationErr := uuid.Parse(operationID)
	var nonzero byte
	for _, b := range originalKey {
		nonzero |= b
	}
	if !validLocalPushStageProof(ctx, sourceID, revision, proof) ||
		stageErr != nil || stage.String() != stageID ||
		operationErr != nil || operation.String() != operationID ||
		generation == 0 || nonzero == 0 ||
		relativeLeaf == "" || len(relativeLeaf) > 255 ||
		relativeLeaf == "." || relativeLeaf == ".." ||
		strings.TrimSpace(relativeLeaf) != relativeLeaf ||
		strings.ContainsAny(relativeLeaf, "/\\\x00\r\n") {
		return empty, errors.New("invalid private first leaf commit scope")
	}
	input, err := json.Marshal(struct {
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
		return empty, errors.New("invalid private first leaf commit input")
	}
	url := localPushStagingURL(sourceID, stageID) + "/operation-first-leaf-commit"
	req, err := c.request(ctx, http.MethodPost, url, bytes.NewReader(input))
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
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return empty, errors.New("private first leaf commit unavailable")
	}
	cache := strings.ToLower(resp.Header.Get("Cache-Control"))
	if resp.Header.Get("ETag") != strconv.Quote(strconv.FormatUint(revision, 10)) ||
		!strings.Contains(cache, "private") || !strings.Contains(cache, "no-store") {
		return empty, errors.New("unfenced private first leaf commit response")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, localPushFirstLeafOperationCommitMaxReply+1))
	if err != nil || len(raw) > localPushFirstLeafOperationCommitMaxReply {
		return empty, errors.New("oversized private first leaf commit response")
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
		Replayed             *bool  `json:"replayed"`
		SQLCommitted         *bool  `json:"sql_committed"`
		CASObserved          *bool  `json:"cas_observed"`
		NativeVerified       *bool  `json:"native_verified"`
		BackupComplete       *bool  `json:"backup_complete"`
		Authoritative        *bool  `json:"authoritative"`
		MissingInferenceSafe *bool  `json:"missing_inference_safe"`
		RetirementSupported  *bool  `json:"retirement_supported"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&got); err != nil {
		return empty, errors.New("invalid private first leaf commit reply")
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return empty, errors.New("trailing private first leaf commit reply")
	}
	if got.SourceID != sourceID || got.Revision != revision ||
		got.StageID != stageID || got.OperationID != operationID ||
		got.Generation != generation || got.NodeID == 0 ||
		got.SourceItemID == 0 || got.State != localPushFirstLeafPendingNativeState ||
		got.Replayed == nil || *got.Replayed != (resp.StatusCode == http.StatusOK) ||
		got.SQLCommitted == nil || !*got.SQLCommitted ||
		got.CASObserved == nil || !*got.CASObserved ||
		got.NativeVerified == nil || *got.NativeVerified ||
		got.BackupComplete == nil || *got.BackupComplete ||
		got.Authoritative == nil || *got.Authoritative ||
		got.MissingInferenceSafe == nil || *got.MissingInferenceSafe ||
		got.RetirementSupported == nil || *got.RetirementSupported {
		return empty, errors.New("unverified private first leaf commit result")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return LocalPushFirstLeafCanonicalReceipt{
		SourceID: sourceID, Revision: revision, StageID: stageID,
		OperationID: operationID, Generation: generation,
		NodeID: got.NodeID, SourceItemID: got.SourceItemID, Replayed: *got.Replayed,
	}, nil
}
