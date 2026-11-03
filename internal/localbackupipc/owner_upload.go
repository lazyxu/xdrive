package localbackupipc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

const OwnerSmallUploadMaxBytes = 4 << 20

// ValidateOwnerUploadedFile checks the actual Server acknowledgement, never a
// fabricated success inferred from bytes supplied by the DSM browser.
func ValidateOwnerUploadedFile(n OwnerFileNode, parentID uint64, name string, size int) bool {
	return ValidOwnerFileID(parentID) && ValidOwnerFolderName(name) &&
		size >= 1 && size <= OwnerSmallUploadMaxBytes &&
		ValidOwnerFileID(n.ID) && ValidOwnerFileID(n.Revision) &&
		n.ParentID != nil && *n.ParentID == parentID &&
		n.Type == "file" && n.Name == name && n.Size == int64(size) &&
		!n.CreatedAt.IsZero() && !n.UpdatedAt.IsZero()
}

// Only bounded user file bytes are accepted: no native path, arbitrary endpoint,
// mounted filesystem access or second CAS writer.
func (c *Client) OwnerUploadSmallFile(
	ctx context.Context, parentID uint64, name string, sha string, data []byte,
) (OwnerFileNode, error) {
	if c == nil || !hasCapability(c.capabilities, "cloud-owner-small-upload") {
		return OwnerFileNode{}, errors.New("owning Agent small upload unavailable")
	}
	if !ValidOwnerFileID(parentID) || !ValidOwnerFolderName(name) ||
		len(data) < 1 || len(data) > OwnerSmallUploadMaxBytes {
		return OwnerFileNode{}, errors.New("invalid Owner upload parameters")
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != sha {
		return OwnerFileNode{}, errors.New("Owner upload data digest mismatch")
	}
	var node client.Node
	if err := c.request(ctx, http.MethodPost, "/v1/cloud/owner-small-upload",
		map[string]any{"parent_id": parentID, "name": name, "sha256": sha, "data": data}, &node); err != nil {
		return OwnerFileNode{}, err
	}
	projected, err := ownerFileNode(node, &parentID)
	if err != nil || !ValidateOwnerUploadedFile(projected, parentID, name, len(data)) {
		return OwnerFileNode{}, errors.New("unverified Owner upload acknowledgement")
	}
	return projected, nil
}
