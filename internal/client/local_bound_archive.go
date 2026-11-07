package client

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
)

// ArchiveLocalBoundSource retains the owning device's Source, Root binding,
// target, cloud data and history. The native proof is mandatory; JWT-only
// archive is never used for local-folder Push.
func (c *Client) ArchiveLocalBoundSource(ctx context.Context, id, revision uint64, proof LocalBoundSourceProof) (Source, error) {
	var out Source
	if id == 0 || revision == 0 {
		return out, fmt.Errorf("positive local Source and revision required")
	}
	req, err := c.request(ctx, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/archive", id), nil)
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
	if err := decodeResponse(response, &out); err != nil {
		return Source{}, err
	}
	if out.ID != id || out.Kind != "local_folder" || out.Direction != "push" ||
		out.Status != "archived" || out.Revision < revision {
		return Source{}, fmt.Errorf("local Source identity, revision or archived state invalid after archive")
	}
	return out, nil
}

// RestoreLocalBoundSource restores the same Source ID and Root binding as
// paused. It does not re-enable scheduling or start a transfer.
func (c *Client) RestoreLocalBoundSource(ctx context.Context, id, revision uint64, proof LocalBoundSourceProof) (Source, error) {
	var out Source
	if id == 0 || revision == 0 {
		return out, fmt.Errorf("positive local Source and revision required")
	}
	req, err := c.request(ctx, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/restore", id), nil)
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
	if err := decodeResponse(response, &out); err != nil {
		return Source{}, err
	}
	if out.ID != id || out.Kind != "local_folder" || out.Direction != "push" ||
		out.Status != "paused" || out.Revision <= revision {
		return Source{}, fmt.Errorf("local Source identity, revision or paused state invalid after restore")
	}
	return out, nil
}
