package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

// LocalBoundIgnoreRules is intentionally separate from generic Source and
// owner-readable DeviceBackup DTOs. Raw rules can contain local path fragments.
type LocalBoundIgnoreRules struct {
	SourceID    uint64 `json:"source_id"`
	Revision    uint64 `json:"revision"`
	IgnoreRules string `json:"ignore_rules"`
}

func localRulesProofHeaders(req *http.Request, proof LocalBoundSourceProof) {
	req.Header.Set("X-XDrive-Device-ID", proof.DeviceID)
	req.Header.Set("X-XDrive-Device-Token", proof.DeviceToken)
	req.Header.Set("X-XDrive-Local-Root-ID", proof.RootID)
	req.Header.Set("X-XDrive-Local-Root-Fingerprint", proof.RootFingerprint)
}

// LocalBoundRules makes the dedicated owner+native-credential+Root protected
// read. Never fall back to the generic redacted Source GET.
func (c *Client) LocalBoundRules(ctx context.Context, id uint64, proof LocalBoundSourceProof) (LocalBoundIgnoreRules, error) {
	var out LocalBoundIgnoreRules
	if id == 0 {
		return out, fmt.Errorf("positive Source ID required")
	}
	req, err := c.request(ctx, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/local-rules", id), nil)
	if err != nil {
		return out, err
	}
	localRulesProofHeaders(req, proof)
	response, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer response.Body.Close()
	if err := decodeResponse(response, &out); err != nil {
		return LocalBoundIgnoreRules{}, err
	}
	if out.SourceID != id || out.Revision == 0 {
		return LocalBoundIgnoreRules{}, fmt.Errorf("local Source rules identity or revision mismatch")
	}
	return out, nil
}

// SetLocalBoundRules uses only ignore_rules in the existing revision-fenced
// Server PATCH. A Web/JWT-only UpdateSource is never an Agent fallback.
func (c *Client) SetLocalBoundRules(ctx context.Context, id, revision uint64, rules string, proof LocalBoundSourceProof) (LocalBoundIgnoreRules, error) {
	var out LocalBoundIgnoreRules
	if id == 0 || revision == 0 {
		return out, fmt.Errorf("positive Source ID and revision required")
	}
	body, err := json.Marshal(UpdateSourceInput{IgnoreRules: &rules})
	if err != nil {
		return out, err
	}
	req, err := c.request(ctx, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", id), bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", strconv.Quote(strconv.FormatUint(revision, 10)))
	localRulesProofHeaders(req, proof)
	response, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer response.Body.Close()
	var updated Source
	if err := decodeResponse(response, &updated); err != nil {
		return out, err
	}
	if updated.ID != id || updated.Kind != "local_folder" || updated.Direction != "push" ||
		updated.Status != "paused" || updated.Revision <= revision {
		return out, fmt.Errorf("updated Source identity, status or revision invalid")
	}
	return LocalBoundIgnoreRules{SourceID: id, Revision: updated.Revision, IgnoreRules: rules}, nil
}
