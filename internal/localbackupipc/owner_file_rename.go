package localbackupipc

import (
	"context"
	"errors"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// ValidateOwnerRenamedNode admits only a revision-advanced copy of the same
// current-Owner item. Neither its directory nor its type may silently change.
func ValidateOwnerRenamedNode(n OwnerFileNode, id, revision, parentID uint64, kind, name string) bool {
	return ValidOwnerFileID(id) && ValidOwnerFileID(revision) &&
		ValidOwnerFileID(parentID) && ValidOwnerFolderName(name) &&
		(kind == "file" || kind == "dir") &&
		n.ID == id && ValidOwnerFileID(n.Revision) && n.Revision > revision &&
		n.ParentID != nil && *n.ParentID == parentID &&
		n.Type == kind && n.Name == name && safeQuotaAmount(n.Size) &&
		!n.CreatedAt.IsZero() && !n.UpdatedAt.IsZero()
}

// OwnerRenameNode reuses the original, authenticated Server/Agent rename RPC.
// Backup-only mode opts in to this exact route; no arbitrary Agent API proxy.
func (c *Client) OwnerRenameNode(
	ctx context.Context, id, revision, parentID uint64, kind, name string,
) (OwnerFileNode, error) {
	if c == nil || !hasCapability(c.capabilities, "cloud-node-rename") {
		return OwnerFileNode{}, errors.New("owning Agent does not support Server Owner node rename")
	}
	if !ValidOwnerFileID(id) || !ValidOwnerFileID(revision) ||
		!ValidOwnerFileID(parentID) || !ValidOwnerFolderName(name) ||
		(kind != "file" && kind != "dir") {
		return OwnerFileNode{}, errors.New("invalid Server Owner node rename selector")
	}
	var node client.Node
	if err := c.request(ctx, http.MethodPatch, "/v1/cloud/nodes",
		map[string]any{"id": id, "revision": revision, "name": name}, &node); err != nil {
		return OwnerFileNode{}, err
	}
	projected, err := ownerFileNode(node, &parentID)
	if err != nil || !ValidateOwnerRenamedNode(projected, id, revision, parentID, kind, name) {
		return OwnerFileNode{}, errors.New("unverified Server Owner renamed node")
	}
	return projected, nil
}
