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

// A strictly private aggregate count; it is not backup/rename success.
type LocalSourceItemEvidenceSummary struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	StagedRecords        int64  `json:"staged_records"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

func validLocalEvidenceGenerationDigest(value string) bool {
	if len(value) != 64 || strings.ToLower(value) != value ||
		value == strings.Repeat("0", 64) {
		return false
	}
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

// ReadLocalSourceItemEvidenceSummary is for the owning Agent only, after
// it verifies the two local journals and its current Root grant. The request
// sends neither an OS path nor a mutable SourceItem/Node contract.
func (c *Client) ReadLocalSourceItemEvidenceSummary(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	previousSHA256, currentSHA256 string,
) (LocalSourceItemEvidenceSummary, error) {
	var empty LocalSourceItemEvidenceSummary
	if ctx == nil || sourceID == 0 || revision == 0 ||
		!validLocalEvidenceGenerationDigest(previousSHA256) ||
		!validLocalEvidenceGenerationDigest(currentSHA256) ||
		previousSHA256 == currentSHA256 {
		return empty, fmt.Errorf("invalid private local evidence generation")
	}
	body, err := json.Marshal(struct {
		PreviousSHA256 string `json:"previous_snapshot_sha256"`
		CurrentSHA256  string `json:"current_snapshot_sha256"`
	}{PreviousSHA256: previousSHA256, CurrentSHA256: currentSHA256})
	if err != nil {
		return empty, err
	}
	req, err := c.request(ctx, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/local-identity/evidence-summary", sourceID),
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
	var got LocalSourceItemEvidenceSummary
	if err := decodeResponse(resp, &got); err != nil {
		return empty, err
	}
	if got.SourceID != sourceID || got.Revision != revision ||
		got.StagedRecords < 0 || got.Authoritative || got.MissingInferenceSafe {
		return empty, fmt.Errorf("unsafe or mismatched local evidence count")
	}
	return got, nil
}
