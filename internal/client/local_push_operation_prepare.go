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

	"github.com/google/uuid"
)

const localPushOperationPrepareMaxReply = 1024

// LocalPushPreparedOperation is a PRIVATE owning-Agent correlation receipt.
// All fields are excluded from JSON to avoid accidental IPC/Renderer exposure.
// It is neither proof of original file bytes nor an upload/SourceRun ticket.
type LocalPushPreparedOperation struct {
	SourceID    uint64 `json:"-"`
	Revision    uint64 `json:"-"`
	OperationID string `json:"-"`
	Generation  uint64 `json:"-"`
	State       string `json:"-"`
}

// PrepareLocalPushOperation is a private Go Client transport intended only
// for the owning Agent while holding its independently validated native Root
// and Source scope. It grants NO execution rights by itself. No background
// job, renderer, Web, or device-backup Agent IPC calls this method yet.
func (c *Client) PrepareLocalPushOperation(ctx context.Context, sourceID, revision uint64,
	proof LocalBoundSourceProof, key [32]byte,
) (LocalPushPreparedOperation, error) {
	var empty LocalPushPreparedOperation
	if ctx == nil || sourceID == 0 || revision == 0 ||
		proof.DeviceID == "" || proof.DeviceToken == "" ||
		proof.RootID == "" || proof.RootFingerprint == "" {
		return empty, fmt.Errorf("invalid private local operation scope")
	}
	var nonzero byte
	for _, v := range key {
		nonzero |= v
	}
	if nonzero == 0 {
		return empty, fmt.Errorf("invalid private local operation key")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	body, err := json.Marshal(struct {
		RequestKey string `json:"request_key"`
	}{RequestKey: base64.RawURLEncoding.EncodeToString(key[:])})
	if err != nil {
		return empty, fmt.Errorf("private local operation unavailable")
	}
	req, err := c.request(ctx, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/local-operation/prepare", sourceID), bytes.NewReader(body))
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
		return empty, fmt.Errorf("unfenced private local operation response")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, localPushOperationPrepareMaxReply+1))
	if err != nil || len(raw) > localPushOperationPrepareMaxReply {
		return empty, fmt.Errorf("invalid private local operation reply")
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
		return empty, fmt.Errorf("invalid private local operation reply")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return empty, fmt.Errorf("trailing private local operation reply")
	}
	id, idErr := uuid.Parse(got.OperationID)
	if got.SourceID != sourceID || got.Revision != revision ||
		idErr != nil || id.String() != got.OperationID ||
		got.Generation == 0 || got.State != "reserved" ||
		got.CommitSupported == nil || *got.CommitSupported ||
		got.BackupComplete == nil || *got.BackupComplete ||
		got.Authoritative == nil || *got.Authoritative ||
		got.MissingInferenceSafe == nil || *got.MissingInferenceSafe {
		return empty, fmt.Errorf("unsafe private local operation receipt")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return LocalPushPreparedOperation{
		SourceID: sourceID, Revision: revision,
		OperationID: got.OperationID, Generation: got.Generation,
		State: "reserved",
	}, nil
}
