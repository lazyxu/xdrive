package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

const localPushOperationStatusMaxReply = 1024

// LocalPushOperationStatus is only an Agent-private observation of the most
// recent Server admission. It never proves a completed backup or transfer.
// No field may be accidentally serialized through Agent IPC or Web.
type LocalPushOperationStatus struct {
	SourceID    uint64 `json:"-"`
	Revision    uint64 `json:"-"`
	OperationID string `json:"-"`
	Generation  uint64 `json:"-"`
	State       string `json:"-"`
}

// ObserveLocalPushOperation reads only the latest exact operation identity,
// using the owning Agent's current enrollment/Root and Source revision.
func (c *Client) ObserveLocalPushOperation(ctx context.Context, sourceID, revision uint64,
	proof LocalBoundSourceProof, operationID string, generation uint64,
) (LocalPushOperationStatus, error) {
	return c.localPushOperationStatus(ctx, sourceID, revision, proof, operationID, generation, "observe")
}

// AbortLocalPushOperation aborts only an unexpired private reservation.
// It is NOT SourceRun cancellation and never implies physical upload stop.
func (c *Client) AbortLocalPushOperation(ctx context.Context, sourceID, revision uint64,
	proof LocalBoundSourceProof, operationID string, generation uint64,
) (LocalPushOperationStatus, error) {
	return c.localPushOperationStatus(ctx, sourceID, revision, proof, operationID, generation, "abort")
}

func (c *Client) localPushOperationStatus(ctx context.Context, sourceID, revision uint64,
	proof LocalBoundSourceProof, operationID string, generation uint64, action string,
) (LocalPushOperationStatus, error) {
	var empty LocalPushOperationStatus
	parsed, parseErr := uuid.Parse(operationID)
	if ctx == nil || sourceID == 0 || revision == 0 || generation == 0 ||
		parseErr != nil || parsed.String() != operationID ||
		proof.DeviceID == "" || proof.DeviceToken == "" ||
		proof.RootID == "" || proof.RootFingerprint == "" ||
		(action != "observe" && action != "abort") {
		return empty, fmt.Errorf("invalid private local operation status request")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	body, err := json.Marshal(struct {
		OperationID string `json:"operation_id"`
		Generation  uint64 `json:"generation"`
	}{OperationID: operationID, Generation: generation})
	if err != nil {
		return empty, fmt.Errorf("private local operation unavailable")
	}
	req, err := c.request(ctx, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/local-operation/%s", sourceID, action),
		bytes.NewReader(body))
	if err != nil {
		return empty, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", strconv.Quote(strconv.FormatUint(revision, 10)))
	localRulesProofHeaders(req, proof)
	resp, err := c.do(req)
	if err != nil {
		return empty, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return empty, fmt.Errorf("private local operation unavailable")
	}
	cache := strings.ToLower(resp.Header.Get("Cache-Control"))
	if resp.Header.Get("ETag") != strconv.Quote(strconv.FormatUint(revision, 10)) ||
		!strings.Contains(cache, "private") || !strings.Contains(cache, "no-store") {
		return empty, fmt.Errorf("unfenced or cacheable private operation status")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, localPushOperationStatusMaxReply+1))
	if err != nil || len(raw) > localPushOperationStatusMaxReply {
		return empty, fmt.Errorf("oversized private operation status")
	}
	var got struct {
		SourceID             uint64 `json:"source_id"`
		Revision             uint64 `json:"revision"`
		OperationID          string `json:"operation_id"`
		Generation           uint64 `json:"generation"`
		State                string `json:"state"`
		CommitSupported      *bool  `json:"commit_supported"`
		BackupComplete       *bool  `json:"backup_complete"`
		Authoritative        *bool  `json:"authoritative"`
		MissingInferenceSafe *bool  `json:"missing_inference_safe"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&got); err != nil {
		return empty, fmt.Errorf("malformed private operation status")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return empty, fmt.Errorf("trailing private operation status")
	}
	uuidValue, uuidErr := uuid.Parse(got.OperationID)
	if got.SourceID != sourceID || got.Revision != revision ||
		uuidErr != nil || uuidValue.String() != got.OperationID ||
		got.OperationID != operationID || got.Generation != generation ||
		got.CommitSupported == nil || *got.CommitSupported ||
		got.BackupComplete == nil || *got.BackupComplete ||
		got.Authoritative == nil || *got.Authoritative ||
		got.MissingInferenceSafe == nil || *got.MissingInferenceSafe {
		return empty, fmt.Errorf("unsafe private operation status")
	}
	if action == "abort" {
		if got.State != "aborted" {
			return empty, fmt.Errorf("unsafe private operation abort status")
		}
	} else if got.State != "reserved" && got.State != "aborted" && got.State != "expired" {
		return empty, fmt.Errorf("invalid private operation observed state")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return LocalPushOperationStatus{
		SourceID: sourceID, Revision: revision,
		OperationID: operationID, Generation: generation, State: got.State,
	}, nil
}
