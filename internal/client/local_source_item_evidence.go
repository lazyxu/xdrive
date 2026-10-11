package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// LocalSourceItemEvidenceInput is private Agent-generated *advisory* evidence.
// It must come from two fully verified Root-scoped local journals, never a
// renderer-supplied path or an unchecked native-identity hint.
type LocalSourceItemEvidenceInput struct {
	SourceItemID           uint64 `json:"source_item_id"`
	PreviousSnapshotSHA256 string `json:"previous_snapshot_sha256"`
	CurrentSnapshotSHA256  string `json:"current_snapshot_sha256"`
	PreviousPathKey        string `json:"previous_path_key"`
	CurrentPathKey         string `json:"current_path_key"`
	PreviousNativeKey      string `json:"previous_native_identity_key"`
	CurrentNativeKey       string `json:"current_native_identity_key"`
	PreviousStrong         bool   `json:"previous_strong_native_identity"`
	CurrentStrong          bool   `json:"current_strong_native_identity"`
	PreviousLinkCount      uint64 `json:"previous_link_count"`
	CurrentLinkCount       uint64 `json:"current_link_count"`
}

type LocalSourceItemEvidenceResult struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	SourceItemID         uint64 `json:"source_item_id"`
	EvidenceID           uint64 `json:"evidence_id"`
	Stored               bool   `json:"stored"`
	Replayed             bool   `json:"replayed"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

// StoreLocalSourceItemEvidence has no Source/SourceItem/alias fallback.
// Only the owning Agent may call it with OS-held credential and native Root.
func (c *Client) StoreLocalSourceItemEvidence(
	ctx context.Context, sourceID, revision uint64,
	proof LocalBoundSourceProof, input LocalSourceItemEvidenceInput,
) (LocalSourceItemEvidenceResult, error) {
	var empty LocalSourceItemEvidenceResult
	if ctx == nil || sourceID == 0 || revision == 0 || input.SourceItemID == 0 ||
		!validLocalIdentityEvidenceInput(input) {
		return empty, fmt.Errorf("invalid private local SourceItem evidence")
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return empty, err
	}
	req, err := c.request(ctx, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/local-identity/evidence", sourceID),
		bytes.NewReader(payload))
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
	var result LocalSourceItemEvidenceResult
	if err := decodeResponse(resp, &result); err != nil {
		return empty, err
	}
	if result.SourceID != sourceID || result.Revision != revision ||
		result.SourceItemID != input.SourceItemID || result.EvidenceID == 0 ||
		!result.Stored || result.Authoritative || result.MissingInferenceSafe {
		return empty, fmt.Errorf("local SourceItem evidence reply violates identity or safety contract")
	}
	return result, nil
}

func validLocalIdentityEvidenceInput(input LocalSourceItemEvidenceInput) bool {
	digest := func(s string) bool {
		if len(s) != 64 || strings.ToLower(s) != s || s == strings.Repeat("0", 64) {
			return false
		}
		for _, c := range s {
			if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
				return false
			}
		}
		return true
	}
	return digest(input.PreviousSnapshotSHA256) &&
		digest(input.CurrentSnapshotSHA256) &&
		input.PreviousSnapshotSHA256 != input.CurrentSnapshotSHA256 &&
		digest(input.PreviousPathKey) && digest(input.CurrentPathKey) &&
		input.PreviousPathKey != input.CurrentPathKey &&
		digest(input.PreviousNativeKey) && input.PreviousNativeKey == input.CurrentNativeKey &&
		input.PreviousStrong && input.CurrentStrong &&
		input.PreviousLinkCount == 1 && input.CurrentLinkCount == 1
}
