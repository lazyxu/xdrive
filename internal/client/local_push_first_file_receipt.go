package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// LocalPushFirstLeafPhysicalReceipt is an Agent-private recovery diagnostic,
// NOT a durable native-origin attestation, execution token or backup success.
// All fields deliberately stay out of IPC/JSON serialization.
type LocalPushFirstLeafPhysicalReceipt struct {
	StageID         string `json:"-"`
	SourceID        uint64 `json:"-"`
	Revision        uint64 `json:"-"`
	NodeID          uint64 `json:"-"`
	SourceItemID    uint64 `json:"-"`
	State           string `json:"-"`
	CASObserved     bool   `json:"-"`
	NativeVerified  bool   `json:"-"`
	BackupComplete  bool   `json:"-"`
	CommitSupported bool   `json:"-"`
	Authoritative   bool   `json:"-"`
}

const localPushPhysicalReceiptOnly = "sql_committed_cas_observed_native_unverified"

// ReadLocalPushFirstLeafPhysicalReceipt checks a previously committed new
// first-leaf Stage, including after its temporary Stage was replaced/expired.
// It is only callable with an actual owning device credential and Root proof.
// This POST is READ-ONLY: the input leaf is never sent in the URL or returned.
// A positive reply is still no proof that an original native file is present.
func (c *Client) ReadLocalPushFirstLeafPhysicalReceipt(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	stageID, relativeLeaf string,
) (LocalPushFirstLeafPhysicalReceipt, error) {
	var empty LocalPushFirstLeafPhysicalReceipt
	parsed, err := uuid.Parse(stageID)
	if !validLocalPushStageProof(ctx, sourceID, revision, proof) ||
		err != nil || parsed.String() != stageID ||
		relativeLeaf == "" || len(relativeLeaf) > 255 ||
		relativeLeaf == "." || relativeLeaf == ".." ||
		strings.TrimSpace(relativeLeaf) != relativeLeaf ||
		strings.ContainsAny(relativeLeaf, "/\\") {
		return empty, errors.New("invalid owning device historical first-leaf receipt request")
	}
	payload, err := json.Marshal(struct {
		RelativeLeaf string `json:"relative_leaf"`
	}{RelativeLeaf: relativeLeaf})
	if err != nil {
		return empty, err
	}
	req, err := c.request(ctx, http.MethodPost,
		localPushStagingURL(sourceID, stageID)+"/physical-receipt",
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
	if resp.Header.Get("ETag") != strconv.Quote(strconv.FormatUint(revision, 10)) ||
		!strings.Contains(strings.ToLower(resp.Header.Get("Cache-Control")), "no-store") {
		return empty, errors.New("unfenced owning-Agent physical receipt")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2049))
	if err != nil || len(raw) > 2048 {
		return empty, errors.New("oversized private physical receipt response")
	}
	var flags map[string]json.RawMessage
	if err := json.Unmarshal(raw, &flags); err != nil {
		return empty, errors.New("invalid private physical receipt authority flags")
	}
	if string(flags["cas_observed"]) != "true" {
		return empty, errors.New("physical CAS was not observed")
	}
	for _, name := range []string{
		"native_verified", "backup_complete", "commit_supported",
		"authoritative", "missing_inference_safe",
	} {
		if string(flags[name]) != "false" {
			return empty, errors.New("physical receipt cannot grant backup or native authority")
		}
	}
	var wire struct {
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
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return empty, errors.New("invalid owning-Agent physical receipt shape")
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return empty, errors.New("trailing physical receipt response")
	}
	if wire.StageID != stageID || wire.SourceID != sourceID ||
		wire.Revision != revision || wire.NodeID == 0 || wire.SourceItemID == 0 ||
		wire.State != localPushPhysicalReceiptOnly ||
		!wire.CASObserved || wire.NativeVerified || wire.BackupComplete ||
		wire.CommitSupported || wire.Authoritative || wire.MissingInferenceSafe ||
		ctx.Err() != nil {
		return empty, errors.New("unsafe or mismatched owning-Agent historical receipt")
	}
	return LocalPushFirstLeafPhysicalReceipt{
		StageID: stageID, SourceID: sourceID, Revision: revision,
		NodeID: wire.NodeID, SourceItemID: wire.SourceItemID,
		State: wire.State, CASObserved: true, NativeVerified: false,
		BackupComplete: false, CommitSupported: false, Authoritative: false,
	}, nil
}
