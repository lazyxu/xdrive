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

const (
	localCommitIntentBatchLimit = 16
	localCommitIntentReplyLimit = 1024
)

// LocalCommitIntentResult describes quarantined advisory proposals ONLY.
// It is not a SourceItem identity commit, a file upload or a deletion grant.
type LocalCommitIntentResult struct {
	SourceID             uint64
	Revision             uint64
	Quarantined          int
	Replayed             int
	CommitSupported      bool
	Authoritative        bool
	MissingInferenceSafe bool
}

// QuarantineLocalSourceCommitIntents is an owning-Agent-only private transport.
// The caller must have independently validated the sealed local journals,
// native Root and current Source revision. The Server RECHECKS ownership,
// device revocation, Root, SourceItem/alias and Node consistency inside its
// own write transaction. Passing this endpoint grants NO canonical writes.
func (c *Client) QuarantineLocalSourceCommitIntents(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	previousSHA256, currentSHA256 string, evidenceIDs []uint64,
) (LocalCommitIntentResult, error) {
	var empty LocalCommitIntentResult
	if ctx == nil || sourceID == 0 || revision == 0 ||
		proof.DeviceID == "" || proof.DeviceToken == "" ||
		proof.RootID == "" || proof.RootFingerprint == "" ||
		!validLocalEvidenceGenerationDigest(previousSHA256) ||
		!validLocalEvidenceGenerationDigest(currentSHA256) ||
		previousSHA256 == currentSHA256 ||
		len(evidenceIDs) == 0 || len(evidenceIDs) > localCommitIntentBatchLimit {
		return empty, fmt.Errorf("invalid private local quarantine request")
	}
	var previous uint64
	for _, id := range evidenceIDs {
		if id <= previous {
			return empty, fmt.Errorf("invalid ordered local quarantine evidence")
		}
		previous = id
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	body, err := json.Marshal(struct {
		PreviousSnapshotSHA256 string   `json:"previous_snapshot_sha256"`
		CurrentSnapshotSHA256  string   `json:"current_snapshot_sha256"`
		EvidenceIDs            []uint64 `json:"evidence_ids"`
	}{
		PreviousSnapshotSHA256: previousSHA256,
		CurrentSnapshotSHA256:  currentSHA256,
		EvidenceIDs:            evidenceIDs,
	})
	if err != nil {
		return empty, err
	}
	req, err := c.request(ctx, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/local-identity/commit-intents", sourceID),
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
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		if resp.StatusCode/100 != 2 {
			return empty, responseError(resp)
		}
		return empty, fmt.Errorf("unexpected local quarantine response status")
	}
	if resp.Header.Get("ETag") != strconv.Quote(strconv.FormatUint(revision, 10)) ||
		!strings.Contains(strings.ToLower(resp.Header.Get("Cache-Control")), "no-store") {
		return empty, fmt.Errorf("unfenced or cacheable local quarantine response")
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, localCommitIntentReplyLimit+1))
	if err != nil || len(payload) > localCommitIntentReplyLimit {
		return empty, fmt.Errorf("oversized local quarantine response")
	}
	// Pointers force ALL hard-false authority flags to be present.
	var got struct {
		SourceID             uint64 `json:"source_id"`
		Revision             uint64 `json:"revision"`
		Quarantined          int    `json:"quarantined"`
		Replayed             int    `json:"replayed"`
		CommitSupported      *bool  `json:"commit_supported"`
		Authoritative        *bool  `json:"authoritative"`
		MissingInferenceSafe *bool  `json:"missing_inference_safe"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&got); err != nil {
		return empty, fmt.Errorf("invalid private quarantine response")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return empty, fmt.Errorf("trailing private quarantine response")
	}
	if got.SourceID != sourceID || got.Revision != revision ||
		got.Quarantined < 0 || got.Replayed < 0 ||
		got.Quarantined > len(evidenceIDs) ||
		got.Replayed != len(evidenceIDs)-got.Quarantined ||
		(resp.StatusCode == http.StatusCreated && got.Quarantined == 0) ||
		(resp.StatusCode == http.StatusOK && got.Quarantined != 0) ||
		got.CommitSupported == nil || *got.CommitSupported ||
		got.Authoritative == nil || *got.Authoritative ||
		got.MissingInferenceSafe == nil || *got.MissingInferenceSafe {
		return empty, fmt.Errorf("unsafe or mismatched private quarantine result")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return LocalCommitIntentResult{
		SourceID: sourceID, Revision: revision,
		Quarantined: got.Quarantined, Replayed: got.Replayed,
		CommitSupported: false, Authoritative: false, MissingInferenceSafe: false,
	}, nil
}
