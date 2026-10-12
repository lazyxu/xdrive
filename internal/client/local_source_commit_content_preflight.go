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

// LocalQuarantinedContentPreflight is a time-bounded, Agent-private CAS
// observation of previously quarantined evidence, NEVER a durable content
// attestation, identity promotion, source-run permission or upload checkpoint.
type LocalQuarantinedContentPreflight struct {
	SourceID             uint64
	Revision             uint64
	Checked              int
	QuarantineMatched    bool
	PhysicalCASMatched   bool
	CloudBytesVerified   bool
	ContentVerified      bool
	CommitSupported      bool
	Authoritative        bool
	MissingInferenceSafe bool
}

// PreflightLocalQuarantinedPhysicalContentBatch is native owning-Agent ONLY.
// It sends no paths, SourceItem/Node IDs, storage keys or arbitrary URLs.
// Successful readback still cannot authorize canonical identity changes.
// No Desktop IPC, renderer, Web/Mobile Web or Agent startup job calls it.
func (c *Client) PreflightLocalQuarantinedPhysicalContentBatch(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	previousSHA256, currentSHA256 string, items []LocalEvidenceCloudDigest,
) (LocalQuarantinedContentPreflight, error) {
	var empty LocalQuarantinedContentPreflight
	if ctx == nil || sourceID == 0 || revision == 0 ||
		proof.DeviceID == "" || proof.DeviceToken == "" ||
		proof.RootID == "" || proof.RootFingerprint == "" ||
		!validLocalEvidenceGenerationDigest(previousSHA256) ||
		!validLocalEvidenceGenerationDigest(currentSHA256) ||
		previousSHA256 == currentSHA256 ||
		len(items) == 0 || len(items) > localPhysicalCASBatchMaxItems {
		return empty, fmt.Errorf("invalid private quarantine physical preflight")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	var prior uint64
	var total int64
	for _, item := range items {
		if item.EvidenceID <= prior || item.Size < 0 ||
			item.Size > localPhysicalCASBatchMaxBytes-total ||
			!validLocalEvidenceGenerationDigest(item.SHA256) {
			return empty, fmt.Errorf("invalid private quarantine claim")
		}
		prior = item.EvidenceID
		total += item.Size
	}
	payload, err := json.Marshal(struct {
		PreviousSHA256 string                     `json:"previous_snapshot_sha256"`
		CurrentSHA256  string                     `json:"current_snapshot_sha256"`
		Items          []LocalEvidenceCloudDigest `json:"items"`
	}{
		PreviousSHA256: previousSHA256, CurrentSHA256: currentSHA256, Items: items,
	})
	if err != nil {
		return empty, err
	}
	req, err := c.request(ctx, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/local-identity/commit-intents/content-preflight", sourceID),
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
	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode/100 != 2 {
			return empty, responseError(resp)
		}
		return empty, fmt.Errorf("unexpected quarantine physical preflight status")
	}
	cache := strings.ToLower(resp.Header.Get("Cache-Control"))
	if resp.Header.Get("ETag") != strconv.Quote(strconv.FormatUint(revision, 10)) ||
		!strings.Contains(cache, "private") || !strings.Contains(cache, "no-store") {
		return empty, fmt.Errorf("unfenced or cacheable quarantine content response")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, localEvidenceCloudMetadataReplyLimit+1))
	if err != nil || len(data) > localEvidenceCloudMetadataReplyLimit {
		return empty, fmt.Errorf("oversized private quarantine content response")
	}
	var got struct {
		SourceID             uint64 `json:"source_id"`
		Revision             uint64 `json:"revision"`
		Checked              int    `json:"checked"`
		QuarantineMatched    *bool  `json:"quarantine_matched"`
		PhysicalCASMatched   *bool  `json:"physical_cas_matched"`
		CloudBytesVerified   *bool  `json:"cloud_bytes_verified"`
		ContentVerified      *bool  `json:"content_verified"`
		CommitSupported      *bool  `json:"commit_supported"`
		Authoritative        *bool  `json:"authoritative"`
		MissingInferenceSafe *bool  `json:"missing_inference_safe"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&got); err != nil {
		return empty, fmt.Errorf("invalid private quarantine content response")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return empty, fmt.Errorf("trailing private quarantine content response")
	}
	if got.SourceID != sourceID || got.Revision != revision || got.Checked != len(items) ||
		got.QuarantineMatched == nil || !*got.QuarantineMatched ||
		got.PhysicalCASMatched == nil || !*got.PhysicalCASMatched ||
		got.CloudBytesVerified == nil || *got.CloudBytesVerified ||
		got.ContentVerified == nil || *got.ContentVerified ||
		got.CommitSupported == nil || *got.CommitSupported ||
		got.Authoritative == nil || *got.Authoritative ||
		got.MissingInferenceSafe == nil || *got.MissingInferenceSafe {
		return empty, fmt.Errorf("unsafe or mismatched quarantine content response")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return LocalQuarantinedContentPreflight{
		SourceID: sourceID, Revision: revision, Checked: len(items),
		QuarantineMatched: true, PhysicalCASMatched: true,
		CloudBytesVerified: false, ContentVerified: false,
		CommitSupported: false, Authoritative: false, MissingInferenceSafe: false,
	}, nil
}
