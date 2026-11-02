package localbackupipc

import (
	"context"
	"errors"
	"net/http"
)

// Only the original authenticated Server cloud delete (move-to-trash) is
// permitted. No native NAS path or permanently destructive CAS operation.
func ValidOwnerDeleteNode(id, revision, parentID uint64, kind, name string) bool {
	return ValidOwnerFileID(id) && ValidOwnerFileID(revision) &&
		ValidOwnerFileID(parentID) && (kind == "file" || kind == "dir") &&
		ValidOwnerFolderName(name)
}

// A successful original Agent/Server DELETE returns exactly {"ok":true}.
// A failed or ambiguous response is never reported as completed deletion.
func (c *Client) OwnerDeleteNode(ctx context.Context,
	id, revision, parentID uint64, kind, name string,
) error {
	if c == nil || !hasCapability(c.capabilities, "cloud-node-delete") {
		return errors.New("owning Agent does not support Server Owner move to trash")
	}
	if !ValidOwnerDeleteNode(id, revision, parentID, kind, name) {
		return errors.New("invalid Server Owner delete selector")
	}
	var reply map[string]any
	if err := c.request(ctx, http.MethodDelete, "/v1/cloud/nodes",
		map[string]any{"id": id, "revision": revision}, &reply); err != nil {
		return err
	}
	if len(reply) != 1 || reply["ok"] != true {
		return errors.New("unverified Server Owner move-to-trash response")
	}
	return nil
}
