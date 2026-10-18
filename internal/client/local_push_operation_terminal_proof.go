package client

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

const localPushTerminalProofMaxReply = 1024

// LocalPushTerminalProof is only a private Server reservation outcome.
// It is NOT a committed-file receipt, an upload token or permission to retire
// an Agent request key. No field can accidentally enter Renderer IPC JSON.
type LocalPushTerminalProof struct {
	SourceID    uint64    `json:"-"`
	Revision    uint64    `json:"-"`
	OperationID string    `json:"-"`
	Generation  uint64    `json:"-"`
	State       string    `json:"-"`
	RecordedAt  time.Time `json:"-"`
}

// ReadLocalPushTerminalProof must be called only by a credentialed owning
// Agent within its independently held native Root window; the Server repeats
// Owner/Device/Root/Source and exact request-key checks transactionally.
// Failure never means the original reservation was safely canceled.
func (c *Client) ReadLocalPushTerminalProof(
	ctx context.Context, sourceID, revision uint64,
	proof LocalBoundSourceProof, key [32]byte,
	operationID string, generation uint64,
) (LocalPushTerminalProof, error) {
	var empty LocalPushTerminalProof
	parsed, parseErr := uuid.Parse(operationID)
	if c == nil || ctx == nil || sourceID == 0 || revision == 0 ||
		generation == 0 || parseErr != nil || parsed.String() != operationID ||
		proof.DeviceID == "" || proof.DeviceToken == "" ||
		proof.RootID == "" || proof.RootFingerprint == "" {
		return empty, fmt.Errorf("invalid private local terminal proof scope")
	}
	var nonzero byte
	for _, v := range key {
		nonzero |= v
	}
	if nonzero == 0 {
		return empty, fmt.Errorf("invalid private local request key")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	body, err := json.Marshal(struct {
		RequestKey  string `json:"request_key"`
		OperationID string `json:"operation_id"`
		Generation  uint64 `json:"generation"`
	}{
		RequestKey:  base64.RawURLEncoding.EncodeToString(key[:]),
		OperationID: operationID, Generation: generation,
	})
	if err != nil {
		return empty, fmt.Errorf("private local terminal unavailable")
	}
	req, err := c.request(ctx, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/local-operation/terminal-proof", sourceID),
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
		return empty, fmt.Errorf("private local terminal unavailable")
	}
	cache := strings.ToLower(resp.Header.Get("Cache-Control"))
	if resp.Header.Get("ETag") != strconv.Quote(strconv.FormatUint(revision, 10)) ||
		!strings.Contains(cache, "private") || !strings.Contains(cache, "no-store") {
		return empty, fmt.Errorf("unfenced private local terminal response")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, localPushTerminalProofMaxReply+1))
	if err != nil || len(raw) > localPushTerminalProofMaxReply {
		return empty, fmt.Errorf("invalid private local terminal response")
	}
	var got struct {
		SourceID             uint64 `json:"source_id"`
		Revision             uint64 `json:"revision"`
		OperationID          string `json:"operation_id"`
		Generation           uint64 `json:"generation"`
		State                string `json:"state"`
		RecordedAt           string `json:"recorded_at"`
		CommitSupported      *bool  `json:"commit_supported"`
		BackupComplete       *bool  `json:"backup_complete"`
		Authoritative        *bool  `json:"authoritative"`
		MissingInferenceSafe *bool  `json:"missing_inference_safe"`
		RetirementSupported  *bool  `json:"retirement_supported"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&got); err != nil {
		return empty, fmt.Errorf("malformed private local terminal response")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return empty, fmt.Errorf("trailing private local terminal response")
	}
	timestamp, stampErr := time.Parse(time.RFC3339Nano, got.RecordedAt)
	if got.SourceID != sourceID || got.Revision != revision ||
		got.OperationID != operationID || got.Generation != generation ||
		(got.State != "aborted" && got.State != "expired") ||
		got.CommitSupported == nil || *got.CommitSupported ||
		got.BackupComplete == nil || *got.BackupComplete ||
		got.Authoritative == nil || *got.Authoritative ||
		got.MissingInferenceSafe == nil || *got.MissingInferenceSafe ||
		got.RetirementSupported == nil || *got.RetirementSupported ||
		stampErr != nil || timestamp.IsZero() ||
		!strings.HasSuffix(got.RecordedAt, "Z") ||
		timestamp.UTC().Format(time.RFC3339Nano) != got.RecordedAt {
		return empty, fmt.Errorf("unsafe private local terminal proof")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return LocalPushTerminalProof{
		SourceID: sourceID, Revision: revision, OperationID: operationID,
		Generation: generation, State: got.State, RecordedAt: timestamp.UTC(),
	}, nil
}
