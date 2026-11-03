package localbackupipc

import (
	"context"
	"errors"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// A move must preserve the same Owner node but advance its Server revision
// and establish the newly chosen target parent.
func ValidateOwnerMovedNode(n OwnerFileNode, id, revision, sourceParent, targetParent uint64, kind, name string) bool {
	return ValidOwnerFileID(id) && ValidOwnerFileID(revision) &&
		ValidOwnerFileID(sourceParent) && ValidOwnerFileID(targetParent) &&
		sourceParent != targetParent && id != targetParent &&
		(kind == "file" || kind == "dir") && ValidOwnerFolderName(name) &&
		n.ID == id && ValidOwnerFileID(n.Revision) && n.Revision > revision &&
		n.ParentID != nil && *n.ParentID == targetParent &&
		n.Type == kind && n.Name == name && safeQuotaAmount(n.Size) &&
		!n.CreatedAt.IsZero() && !n.UpdatedAt.IsZero()
}

func (c *Client) OwnerMoveNode(ctx context.Context,
	id, revision, sourceParent, targetParent uint64, kind, name string,
) (OwnerFileNode, error) {
	if c == nil || !hasCapability(c.capabilities, "cloud-node-move") {
		return OwnerFileNode{}, errors.New("owning Agent does not support Server Owner node move")
	}
	if !ValidOwnerFileID(id) || !ValidOwnerFileID(revision) ||
		!ValidOwnerFileID(sourceParent) || !ValidOwnerFileID(targetParent) ||
		sourceParent == targetParent || id == targetParent ||
		(kind != "file" && kind != "dir") || !ValidOwnerFolderName(name) {
		return OwnerFileNode{}, errors.New("invalid Server Owner node move selector")
	}
	var node client.Node
	if err := c.request(ctx, http.MethodPatch, "/v1/cloud/move",
		map[string]any{"id": id, "revision": revision, "parent_id": targetParent}, &node); err != nil {
		return OwnerFileNode{}, err
	}
	projected, err := ownerFileNode(node, &targetParent)
	if err != nil || !ValidateOwnerMovedNode(projected, id, revision, sourceParent, targetParent, kind, name) {
		return OwnerFileNode{}, errors.New("unverified Server Owner move acknowledgement")
	}
	return projected, nil
}
