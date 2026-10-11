package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
)

const (
	localSourceEvidencePageLimit            = 64
	localSourceEvidencePageMaxResponseBytes = 64 << 10
)

// The owning native Agent alone may receive the opaque candidate keys and
// existing SourceItem IDs needed for later LOCAL verification. This is not a
// general Source view or a cloud mutation authorization.
type LocalSourceItemEvidencePageItem struct {
	EvidenceID        uint64 `json:"evidence_id"`
	SourceItemID      uint64 `json:"source_item_id"`
	PreviousPathKey   string `json:"previous_path_key"`
	CurrentPathKey    string `json:"current_path_key"`
	NativeIdentityKey string `json:"native_identity_key"`
}

type LocalSourceItemEvidencePage struct {
	SourceID             uint64                            `json:"source_id"`
	Revision             uint64                            `json:"revision"`
	Items                []LocalSourceItemEvidencePageItem `json:"items"`
	HasMore              bool                              `json:"has_more"`
	NextAfterID          uint64                            `json:"next_after_id"`
	Authoritative        bool                              `json:"authoritative"`
	MissingInferenceSafe bool                              `json:"missing_inference_safe"`
}

// ReadLocalSourceItemEvidencePage is a bounded keyset read for the owning
// Agent after checking both sealed local generations. Never feed this data
// directly into SourceItem alias promotion, cloud move or Mirror deletion.
func (c *Client) ReadLocalSourceItemEvidencePage(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	previousSHA256, currentSHA256 string, limit int, afterEvidenceID uint64,
) (LocalSourceItemEvidencePage, error) {
	var empty LocalSourceItemEvidencePage
	if ctx == nil || sourceID == 0 || revision == 0 ||
		proof.DeviceID == "" || proof.DeviceToken == "" ||
		proof.RootID == "" || proof.RootFingerprint == "" ||
		limit < 1 || limit > localSourceEvidencePageLimit ||
		!validLocalEvidenceGenerationDigest(previousSHA256) ||
		!validLocalEvidenceGenerationDigest(currentSHA256) ||
		previousSHA256 == currentSHA256 {
		return empty, fmt.Errorf("invalid owning Agent advisory evidence page")
	}
	body, err := json.Marshal(struct {
		PreviousSHA256  string `json:"previous_snapshot_sha256"`
		CurrentSHA256   string `json:"current_snapshot_sha256"`
		AfterEvidenceID uint64 `json:"after_evidence_id"`
		Limit           int    `json:"limit"`
	}{
		PreviousSHA256: previousSHA256, CurrentSHA256: currentSHA256,
		AfterEvidenceID: afterEvidenceID, Limit: limit,
	})
	if err != nil {
		return empty, err
	}
	req, err := c.request(ctx, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/local-identity/evidence-page", sourceID),
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
		if resp.StatusCode/100 != 2 {
			return empty, responseError(resp)
		}
		return empty, fmt.Errorf("unexpected local evidence page status")
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, localSourceEvidencePageMaxResponseBytes+1))
	if err != nil || len(payload) > localSourceEvidencePageMaxResponseBytes {
		return empty, fmt.Errorf("oversized local evidence page response")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var got LocalSourceItemEvidencePage
	if err := decoder.Decode(&got); err != nil {
		return empty, fmt.Errorf("invalid local evidence page response")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return empty, fmt.Errorf("trailing local evidence page response")
	}
	if got.SourceID != sourceID || got.Revision != revision ||
		got.Authoritative || got.MissingInferenceSafe ||
		len(got.Items) > limit ||
		(got.HasMore && len(got.Items) != limit) {
		return empty, fmt.Errorf("unsafe or mismatched local evidence page")
	}
	var lastID uint64 = afterEvidenceID
	seenItems := make(map[uint64]struct{}, len(got.Items))
	for _, row := range got.Items {
		if row.EvidenceID <= lastID || row.SourceItemID == 0 ||
			!validLocalEvidenceGenerationDigest(row.PreviousPathKey) ||
			!validLocalEvidenceGenerationDigest(row.CurrentPathKey) ||
			!validLocalEvidenceGenerationDigest(row.NativeIdentityKey) ||
			row.PreviousPathKey == row.CurrentPathKey {
			return empty, fmt.Errorf("invalid advisory candidate identity")
		}
		if _, duplicate := seenItems[row.SourceItemID]; duplicate {
			return empty, fmt.Errorf("duplicate advisory candidate")
		}
		seenItems[row.SourceItemID] = struct{}{}
		lastID = row.EvidenceID
	}
	if len(got.Items) == 0 {
		if got.HasMore || got.NextAfterID != 0 {
			return empty, fmt.Errorf("invalid empty advisory page cursor")
		}
	} else if got.NextAfterID != lastID {
		return empty, fmt.Errorf("invalid advisory page cursor")
	}
	return got, nil
}
