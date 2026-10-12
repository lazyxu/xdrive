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

// LocalEvidencePhysicalCAS is an Agent-PRIVATE point-in-time sample, not a
// durable attestation of Server storage and never a SourceRun/commit token.
type LocalEvidencePhysicalCAS struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	Checked              int    `json:"checked"`
	CloudMetadataMatched bool   `json:"cloud_metadata_matched"`
	PhysicalCASMatched   bool   `json:"physical_cas_matched"`
	CloudBytesVerified   bool   `json:"cloud_bytes_verified"`
	ContentVerified      bool   `json:"content_verified"`
	CommitSupported      bool   `json:"commit_supported"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

// CheckLocalSourceItemCloudBytes allows the owning Agent to ask the Server to
// hash ONE canonical CAS object <=64 MiB after independently hashing the local
// original. The Server rechecks all DB evidence after the physical read.
// No token/path/key/Node ID is accepted or returned. Deliberately not IPC.
func (c *Client) CheckLocalSourceItemCloudBytes(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	previousSHA256, currentSHA256 string, item LocalEvidenceCloudDigest,
) (LocalEvidencePhysicalCAS, error) {
	var empty LocalEvidencePhysicalCAS
	if ctx == nil || sourceID == 0 || revision == 0 ||
		proof.DeviceID == "" || proof.DeviceToken == "" ||
		proof.RootID == "" || proof.RootFingerprint == "" ||
		!validLocalEvidenceGenerationDigest(previousSHA256) ||
		!validLocalEvidenceGenerationDigest(currentSHA256) ||
		previousSHA256 == currentSHA256 || item.EvidenceID == 0 ||
		item.Size < 0 || item.Size > 64<<20 ||
		!validLocalEvidenceGenerationDigest(item.SHA256) {
		return empty, fmt.Errorf("invalid physical CAS sample")
	}
	body, err := json.Marshal(struct {
		PreviousSHA256 string                     `json:"previous_snapshot_sha256"`
		CurrentSHA256  string                     `json:"current_snapshot_sha256"`
		Items          []LocalEvidenceCloudDigest `json:"items"`
	}{
		PreviousSHA256: previousSHA256, CurrentSHA256: currentSHA256,
		Items: []LocalEvidenceCloudDigest{item},
	})
	if err != nil {
		return empty, err
	}
	req, err := c.request(ctx, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/local-identity/evidence-cloud-bytes", sourceID),
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
		return empty, fmt.Errorf("unexpected physical CAS sample status")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, localEvidenceCloudMetadataReplyLimit+1))
	if err != nil || len(data) > localEvidenceCloudMetadataReplyLimit {
		return empty, fmt.Errorf("oversized physical CAS sample reply")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var got LocalEvidencePhysicalCAS
	if err := decoder.Decode(&got); err != nil {
		return empty, fmt.Errorf("invalid physical CAS sample reply")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return empty, fmt.Errorf("trailing physical CAS sample reply")
	}
	if got.SourceID != sourceID || got.Revision != revision || got.Checked != 1 ||
		!got.CloudMetadataMatched || !got.PhysicalCASMatched ||
		got.CloudBytesVerified || got.ContentVerified ||
		got.CommitSupported || got.Authoritative || got.MissingInferenceSafe {
		return empty, fmt.Errorf("unsafe or mismatched physical CAS sample reply")
	}
	return got, nil
}
