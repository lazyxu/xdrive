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
)

const localCommitIntentPageResponseMaxBytes = 1024

// LocalCommitIntentPage is an Agent-private, non-authoritative snapshot of
// persisted QUARANTINED proposal IDs, never a commit or executor token.
type LocalCommitIntentPage struct {
	SourceID             uint64
	Revision             uint64
	EvidenceIDs          []uint64
	HasMore              bool
	NextAfterID          uint64
	CommitSupported      bool
	Authoritative        bool
	MissingInferenceSafe bool
}

// ReadLocalSourceCommitIntentPage is for the owning native Agent ONLY.
// The Server independently fences the same device, Root and Source revision
// in its read transaction; do not expose this through Desktop IPC or Web.
func (c *Client) ReadLocalSourceCommitIntentPage(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	previousSHA256, currentSHA256 string, limit int, afterEvidenceID uint64,
) (LocalCommitIntentPage, error) {
	var empty LocalCommitIntentPage
	if ctx == nil || sourceID == 0 || revision == 0 ||
		proof.DeviceID == "" || proof.DeviceToken == "" ||
		proof.RootID == "" || proof.RootFingerprint == "" ||
		limit < 1 || limit > localCommitIntentBatchLimit ||
		!validLocalEvidenceGenerationDigest(previousSHA256) ||
		!validLocalEvidenceGenerationDigest(currentSHA256) ||
		previousSHA256 == currentSHA256 {
		return empty, fmt.Errorf("invalid owning Agent quarantine read")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
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
		fmt.Sprintf("/api/v1/sources/%d/local-identity/commit-intents/page", sourceID),
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
		return empty, fmt.Errorf("unexpected private quarantine page status")
	}
	if resp.Header.Get("ETag") != strconv.Quote(strconv.FormatUint(revision, 10)) ||
		!strings.Contains(strings.ToLower(resp.Header.Get("Cache-Control")), "no-store") {
		return empty, fmt.Errorf("unfenced or cacheable quarantine read")
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, localCommitIntentPageResponseMaxBytes+1))
	if err != nil || len(payload) > localCommitIntentPageResponseMaxBytes {
		return empty, fmt.Errorf("oversized private quarantine page")
	}
	var got struct {
		SourceID             uint64   `json:"source_id"`
		Revision             uint64   `json:"revision"`
		EvidenceIDs          []uint64 `json:"quarantined_evidence_ids"`
		HasMore              *bool    `json:"has_more"`
		NextAfterID          *uint64  `json:"next_after_id"`
		CommitSupported      *bool    `json:"commit_supported"`
		Authoritative        *bool    `json:"authoritative"`
		MissingInferenceSafe *bool    `json:"missing_inference_safe"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&got); err != nil {
		return empty, fmt.Errorf("invalid private quarantine page")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return empty, fmt.Errorf("trailing private quarantine page data")
	}
	if got.SourceID != sourceID || got.Revision != revision ||
		got.EvidenceIDs == nil || len(got.EvidenceIDs) > limit ||
		got.HasMore == nil || got.NextAfterID == nil ||
		(*got.HasMore && len(got.EvidenceIDs) != limit) ||
		got.CommitSupported == nil || *got.CommitSupported ||
		got.Authoritative == nil || *got.Authoritative ||
		got.MissingInferenceSafe == nil || *got.MissingInferenceSafe {
		return empty, fmt.Errorf("unsafe private quarantine page")
	}
	last := afterEvidenceID
	for _, id := range got.EvidenceIDs {
		if id <= last {
			return empty, fmt.Errorf("unordered private quarantine evidence IDs")
		}
		last = id
	}
	if len(got.EvidenceIDs) == 0 {
		if *got.HasMore || *got.NextAfterID != 0 {
			return empty, fmt.Errorf("invalid empty quarantine cursor")
		}
	} else if *got.NextAfterID != last {
		return empty, fmt.Errorf("invalid quarantine cursor")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return LocalCommitIntentPage{
		SourceID: sourceID, Revision: revision,
		EvidenceIDs: got.EvidenceIDs, HasMore: *got.HasMore, NextAfterID: *got.NextAfterID,
		CommitSupported: false, Authoritative: false, MissingInferenceSafe: false,
	}, nil
}
