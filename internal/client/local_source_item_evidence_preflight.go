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
	localEvidencePreflightBatchLimit    = 64
	localEvidencePreflightReplyMaxBytes = 1024
)

// A point-in-time Server consistency observation for already-persisted
// advisory candidates. Neither this response nor its ETag is a commit token.
type LocalEvidencePreflight struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	Checked              int    `json:"checked"`
	ServerConsistent     bool   `json:"server_consistent"`
	ContentVerified      bool   `json:"content_verified"`
	CommitSupported      bool   `json:"commit_supported"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

func (c *Client) PreflightLocalSourceItemEvidence(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	previousSHA256, currentSHA256 string, evidenceIDs []uint64,
) (LocalEvidencePreflight, error) {
	var empty LocalEvidencePreflight
	if ctx == nil || sourceID == 0 || revision == 0 ||
		proof.DeviceID == "" || proof.DeviceToken == "" ||
		proof.RootID == "" || proof.RootFingerprint == "" ||
		!validLocalEvidenceGenerationDigest(previousSHA256) ||
		!validLocalEvidenceGenerationDigest(currentSHA256) ||
		previousSHA256 == currentSHA256 ||
		len(evidenceIDs) == 0 || len(evidenceIDs) > localEvidencePreflightBatchLimit {
		return empty, fmt.Errorf("invalid owning Agent evidence preflight")
	}
	var previous uint64
	for _, id := range evidenceIDs {
		if id <= previous {
			return empty, fmt.Errorf("unordered or invalid evidence identifiers")
		}
		previous = id
	}
	body, err := json.Marshal(struct {
		PreviousSnapshotSHA256 string   `json:"previous_snapshot_sha256"`
		CurrentSnapshotSHA256  string   `json:"current_snapshot_sha256"`
		EvidenceIDs            []uint64 `json:"evidence_ids"`
	}{
		PreviousSnapshotSHA256: previousSHA256,
		CurrentSnapshotSHA256:  currentSHA256, EvidenceIDs: evidenceIDs,
	})
	if err != nil {
		return empty, err
	}
	req, err := c.request(ctx, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/local-identity/evidence-preflight", sourceID),
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
		return empty, fmt.Errorf("unexpected evidence preflight response")
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, localEvidencePreflightReplyMaxBytes+1))
	if err != nil || len(payload) > localEvidencePreflightReplyMaxBytes {
		return empty, fmt.Errorf("oversized evidence preflight response")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var got LocalEvidencePreflight
	if err := decoder.Decode(&got); err != nil {
		return empty, fmt.Errorf("invalid evidence preflight response")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return empty, fmt.Errorf("trailing evidence preflight response")
	}
	if got.SourceID != sourceID || got.Revision != revision ||
		got.Checked != len(evidenceIDs) || !got.ServerConsistent ||
		got.ContentVerified || got.CommitSupported ||
		got.Authoritative || got.MissingInferenceSafe {
		return empty, fmt.Errorf("unsafe or mismatched evidence preflight response")
	}
	return got, nil
}
