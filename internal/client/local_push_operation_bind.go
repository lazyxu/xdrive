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

const localPushOperationBindMaxReply = 1024

// Private non-authoritative durable Stage↔Operation correlation. Never
// serialize it to Electron IPC, Web/Renderer or a generic Source response.
type LocalPushOperationStageBinding struct {
	SourceID    uint64 `json:"-"`
	Revision    uint64 `json:"-"`
	StageID     string `json:"-"`
	OperationID string `json:"-"`
	Generation  uint64 `json:"-"`
}

// BindLocalPushOperationStage is reserved for the owning native Agent with
// its OS-private original request key; it does not finalize an upload.
func (c *Client) BindLocalPushOperationStage(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	stageID string, key [32]byte, operationID string, generation uint64,
) (LocalPushOperationStageBinding, error) {
	var empty LocalPushOperationStageBinding
	if ctx == nil {
		return empty, errors.New("invalid private operation bind scope")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	stage, stageErr := uuid.Parse(stageID)
	operation, operationErr := uuid.Parse(operationID)
	var nonzero byte
	for _, b := range key {
		nonzero |= b
	}
	if !validLocalPushStageProof(ctx, sourceID, revision, proof) ||
		stageErr != nil || stage.String() != stageID ||
		operationErr != nil || operation.String() != operationID ||
		generation == 0 || nonzero == 0 {
		return empty, errors.New("invalid private operation bind scope")
	}
	input, err := json.Marshal(struct {
		RequestKey  string `json:"request_key"`
		OperationID string `json:"operation_id"`
		Generation  uint64 `json:"generation"`
	}{
		RequestKey:  base64.RawURLEncoding.EncodeToString(key[:]),
		OperationID: operationID, Generation: generation,
	})
	if err != nil {
		return empty, errors.New("private operation bind unavailable")
	}
	path := fmt.Sprintf("/api/v1/sources/%d/local-staging/%s/operation-bind", sourceID, stageID)
	req, err := c.request(ctx, http.MethodPost, path, bytes.NewReader(input))
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
		return empty, errors.New("private operation bind unavailable")
	}
	cache := strings.ToLower(resp.Header.Get("Cache-Control"))
	if resp.Header.Get("ETag") != strconv.Quote(strconv.FormatUint(revision, 10)) ||
		!strings.Contains(cache, "private") || !strings.Contains(cache, "no-store") {
		return empty, errors.New("unfenced private operation bind response")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, localPushOperationBindMaxReply+1))
	if err != nil || len(data) > localPushOperationBindMaxReply {
		return empty, errors.New("oversized private operation bind response")
	}
	var got struct {
		SourceID             uint64 `json:"source_id"`
		Revision             uint64 `json:"revision"`
		StageID              string `json:"stage_id"`
		OperationID          string `json:"operation_id"`
		Generation           uint64 `json:"generation"`
		State                string `json:"state"`
		CommitSupported      *bool  `json:"commit_supported"`
		BackupComplete       *bool  `json:"backup_complete"`
		Authoritative        *bool  `json:"authoritative"`
		MissingInferenceSafe *bool  `json:"missing_inference_safe"`
		RetirementSupported  *bool  `json:"retirement_supported"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&got) != nil {
		return empty, errors.New("invalid private operation bind response")
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return empty, errors.New("trailing private operation bind response")
	}
	if got.SourceID != sourceID || got.Revision != revision ||
		got.StageID != stageID || got.OperationID != operationID ||
		got.Generation != generation || got.State != "bound" ||
		got.CommitSupported == nil || *got.CommitSupported ||
		got.BackupComplete == nil || *got.BackupComplete ||
		got.Authoritative == nil || *got.Authoritative ||
		got.MissingInferenceSafe == nil || *got.MissingInferenceSafe ||
		got.RetirementSupported == nil || *got.RetirementSupported {
		return empty, errors.New("unsafe private operation bind reply")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return LocalPushOperationStageBinding{
		SourceID: sourceID, Revision: revision, StageID: stageID,
		OperationID: operationID, Generation: generation,
	}, nil
}
