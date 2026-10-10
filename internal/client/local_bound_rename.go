package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

// LocalBoundBackupSettings is the only private configuration data passed to
// the owning Desktop; no Root, token, local path or Source internals.
type LocalBoundBackupSettings struct {
	SourceID uint64 `json:"source_id"`
	Name     string `json:"name"`
	Revision uint64 `json:"revision"`
}

type LocalBoundSourceProof struct {
	DeviceID        string
	DeviceToken     string
	RootID          string
	RootFingerprint string
}

// RenameLocalBoundSource carries the native proof required by the Server's
// transaction-fenced PATCH. JWT-only UpdateSource is not a local fallback.
func (c *Client) RenameLocalBoundSource(ctx context.Context, id, revision uint64, name string, proof LocalBoundSourceProof) (Source, error) {
	var out Source
	body, err := json.Marshal(UpdateSourceInput{Name: &name})
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
