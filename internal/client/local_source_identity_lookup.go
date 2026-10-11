package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// LocalIdentityMatch is a point-in-time, private Server lookup of an already
// persisted canonical/alias SourceItem identity, never execution authority.
type LocalIdentityMatch struct {
	Index        int    `json:"index"`
	SourceItemID uint64 `json:"source_item_id"`
}

type LocalIdentityLookup struct {
	SourceID             uint64               `json:"source_id"`
	Revision             uint64               `json:"revision"`
	InputCount           int                  `json:"input_count"`
	Matches              []LocalIdentityMatch `json:"matches"`
	Authoritative        bool                 `json:"authoritative"`
	MissingInferenceSafe bool                 `json:"missing_inference_safe"`
}

// LocalSourceIdentityLookup is Agent-private: no generic Source fallback,
// no Electron Preload or Web adapter, and no local SourceRun activation.
// Caller must hold OS-enrolled device credential and current Root grant.
func (c *Client) LocalSourceIdentityLookup(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof, identities []string,
) (LocalIdentityLookup, error) {
	var empty LocalIdentityLookup
	if ctx == nil || sourceID == 0 || revision == 0 || len(identities) == 0 || len(identities) > 128 {
		return empty, fmt.Errorf("local identity lookup requires Source, revision and 1-128 identities")
	}
	seen := make(map[string]struct{}, len(identities))
	for _, identity := range identities {
		if identity == "" || identity != strings.TrimSpace(identity) || len([]byte(identity)) > 512 || !utf8.ValidString(identity) {
			return empty, fmt.Errorf("invalid local identity lookup key")
		}
		for _, char := range identity {
			if unicode.IsControl(char) {
				return empty, fmt.Errorf("invalid local identity lookup key")
			}
		}
		if _, exists := seen[identity]; exists {
			return empty, fmt.Errorf("duplicate local identity lookup key")
		}
		seen[identity] = struct{}{}
	}
	payload, err := json.Marshal(struct {
		Identities []string `json:"identities"`
	}{Identities: identities})
	if err != nil {
		return empty, err
	}
	req, err := c.request(ctx, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/local-identity/lookup", sourceID), bytes.NewReader(payload))
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
	var out LocalIdentityLookup
	if err := decodeResponse(resp, &out); err != nil {
		return empty, err
	}
	if out.SourceID != sourceID || out.Revision != revision || out.InputCount != len(identities) ||
		out.Authoritative || out.MissingInferenceSafe || len(out.Matches) > len(identities) {
		return empty, fmt.Errorf("local identity lookup response identity or safety mismatch")
	}
	matches := make(map[int]struct{}, len(out.Matches))
	for _, match := range out.Matches {
		if match.Index < 0 || match.Index >= len(identities) || match.SourceItemID == 0 {
			return empty, fmt.Errorf("invalid local SourceItem lookup result")
		}
		if _, duplicate := matches[match.Index]; duplicate {
			return empty, fmt.Errorf("duplicate local SourceItem lookup result")
		}
		matches[match.Index] = struct{}{}
	}
	return out, nil
}
