package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

// SetLocalBoundBackupMode changes only the saved Backup/Mirror policy.
// The Agent must prove the exact native Root; JWT-only Source PATCH is
// deliberately not a fallback. This cannot start a SourceRun.
func (c *Client) SetLocalBoundBackupMode(ctx context.Context, id, revision uint64, mode string, proof LocalBoundSourceProof) (Source, error) {
	var out Source
	if id == 0 || revision == 0 || (mode != "backup" && mode != "mirror") {
		return out, fmt.Errorf("invalid Source, revision or backup policy")
	}
	body, err := json.Marshal(UpdateSourceInput{SyncMode: &mode})
	if err != nil {
		return out, err
	}
	req, err := c.request(ctx, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", id), bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", strconv.Quote(strconv.FormatUint(revision, 10)))
	req.Header.Set("X-XDrive-Device-ID", proof.DeviceID)
	req.Header.Set("X-XDrive-Device-Token", proof.DeviceToken)
	req.Header.Set("X-XDrive-Local-Root-ID", proof.RootID)
	req.Header.Set("X-XDrive-Local-Root-Fingerprint", proof.RootFingerprint)
	response, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer response.Body.Close()
	if err := decodeResponse(response, &out); err != nil {
		return Source{}, err
	}
	return out, nil
}
