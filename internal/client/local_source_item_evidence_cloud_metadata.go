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
	localEvidenceCloudMetadataBatchLimit = 64
	localEvidenceCloudMetadataReplyLimit = 1024
)

// Never persist or expose these per-file hashes outside the owning native
// Agent. A successful metadata check does NOT verify object-storage bytes.
type LocalEvidenceCloudDigest struct {
	EvidenceID uint64 `json:"evidence_id"`
	SHA256     string `json:"sha256"`
	Size       int64  `json:"size"`
}

type LocalEvidenceCloudMetadata struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	Checked              int    `json:"checked"`
	CloudMetadataMatched bool   `json:"cloud_metadata_matched"`
	CloudBytesVerified   bool   `json:"cloud_bytes_verified"`
	ContentVerified      bool   `json:"content_verified"`
	CommitSupported      bool   `json:"commit_supported"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

// CheckLocalSourceItemCloudMetadata is an ephemeral, all-or-nothing, owning
// Agent-only read against current CAS *database metadata*. The caller must
// have independently hashed its native files and revalidate its Root/session
// after this request. Never use this result as an upload or commit token.
func (c *Client) CheckLocalSourceItemCloudMetadata(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	previousSHA256, currentSHA256 string, items []LocalEvidenceCloudDigest,
) (LocalEvidenceCloudMetadata, error) {
	var empty LocalEvidenceCloudMetadata
	if ctx == nil || sourceID == 0 || revision == 0 ||
		proof.DeviceID == "" || proof.DeviceToken == "" ||
		proof.RootID == "" || proof.RootFingerprint == "" ||
		!validLocalEvidenceGenerationDigest(previousSHA256) ||
		!validLocalEvidenceGenerationDigest(currentSHA256) ||
		previousSHA256 == currentSHA256 ||
		len(items) == 0 || len(items) > localEvidenceCloudMetadataBatchLimit {
		return empty, fmt.Errorf("invalid owning Agent cloud metadata check")
	}
	var lastID uint64
	for _, item := range items {
		if item.EvidenceID <= lastID || item.Size < 0 ||
			!validLocalEvidenceGenerationDigest(item.SHA256) {
			return empty, fmt.Errorf("invalid ordered local SHA256 evidence")
		}
		lastID = item.EvidenceID
	}
	body, err := json.Marshal(struct {
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
		fmt.Sprintf("/api/v1/sources/%d/local-identity/evidence-cloud-metadata", sourceID),
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
		return empty, fmt.Errorf("unexpected local cloud metadata status")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, localEvidenceCloudMetadataReplyLimit+1))
	if err != nil || len(data) > localEvidenceCloudMetadataReplyLimit {
		return empty, fmt.Errorf("oversized local cloud metadata response")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var got LocalEvidenceCloudMetadata
	if err := decoder.Decode(&got); err != nil {
		return empty, fmt.Errorf("invalid local cloud metadata response")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return empty, fmt.Errorf("trailing local cloud metadata response")
	}
	if got.SourceID != sourceID || got.Revision != revision ||
		got.Checked != len(items) || !got.CloudMetadataMatched ||
		got.CloudBytesVerified || got.ContentVerified || got.CommitSupported ||
		got.Authoritative || got.MissingInferenceSafe {
		return empty, fmt.Errorf("unsafe or mismatched local cloud metadata response")
	}
	return got, nil
}
