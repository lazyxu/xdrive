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
	LocalGrantRemoved bool   `json:"local_grant_removed"`
}

// RemoveLocalBoundSource never falls back to JWT-only generic deletion.
// The Server verifies this proof and rejects a Source with historical state.
func (c *Client) RemoveLocalBoundSource(ctx context.Context, id, revision uint64, proof LocalBoundSourceProof) error {
	if id == 0 || revision == 0 {
		return fmt.Errorf("positive local Source and revision required")
	}
	req, err := c.request(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/sources/%d", id), nil)
	if err != nil {
		return err
	}
	req.Header.Set("If-Match", strconv.Quote(strconv.FormatUint(revision, 10)))
	req.Header.Set("X-XDrive-Device-ID", proof.DeviceID)
	req.Header.Set("X-XDrive-Device-Token", proof.DeviceToken)
	req.Header.Set("X-XDrive-Local-Root-ID", proof.RootID)
	req.Header.Set("X-XDrive-Local-Root-Fingerprint", proof.RootFingerprint)
	response, err := c.do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	return decodeResponse(response, nil)
}
