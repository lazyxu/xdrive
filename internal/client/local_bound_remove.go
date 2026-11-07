package client

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
)

// LocalBoundBackupRemoval acknowledges both Server removal and the separate
// local OS-private Root grant cleanup outcome, without disclosing a local path.
type LocalBoundBackupRemoval struct {
	SourceID          uint64 `json:"source_id"`
	Status            string `json:"status,omitempty"`
	LocalGrantRemoved bool   `json:"local_grant_removed"`
}

// RemoveLocalBoundSource never falls back to JWT-only generic deletion.
// The Server verifies this proof and rejects a Source with historical state.
func (c *Client) RemoveLocalBoundSource(ctx context.Context, id, revision uint64, proof LocalBoundSourceProof) (Source, error) {
	var out Source
	if id == 0 || revision == 0 {
		return out, fmt.Errorf("positive local Source and revision required")
	}
	req, err := c.request(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/sources/%d", id), nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("If-Match", strconv.Quote(strconv.FormatUint(revision, 10)))
	localRulesProofHeaders(req, proof)
	response, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer response.Body.Close()
	// DELETE is allowed to hard-delete only a pristine local draft (204).
	// Newer Servers may archive a configured Source and return its DTO (200).
	// Surface that result to the Agent so it NEVER removes the local Root grant.
	if response.StatusCode == http.StatusNoContent {
		return Source{}, nil
	}
	if response.StatusCode == http.StatusOK {
		if err := decodeResponse(response, &out); err != nil {
			return Source{}, err
		}
		if out.ID != id || out.Kind != "local_folder" || out.Direction != "push" ||
			out.Status != "archived" || out.Revision < revision {
			return Source{}, fmt.Errorf("unexpected Source response after local removal")
		}
		return out, nil
	}
	return Source{}, decodeResponse(response, nil)
}
