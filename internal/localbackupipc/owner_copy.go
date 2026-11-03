package localbackupipc

import (
	"context"
	"errors"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// Copy receipt is a newly created cloud node in the chosen Owner folder.
// The underlying original Agent Copy accepts ID and parent, not a revision;
// the incoming revision is a current-row selection guard, not a claim of a
// Server-enforced compare-and-swap on source contents.
func ValidateOwnerCopiedNode(n OwnerFileNode,
	sourceID, revision, sourceParent, targetParent uint64,
	kind, name string,
) bool {
	return ValidOwnerFileID(sourceID) && ValidOwnerFileID(revision) &&
		ValidOwnerFileID(sourceParent) && ValidOwnerFileID(targetParent) &&
		sourceID != targetParent && sourceParent != targetParent &&
		(kind == "file" || kind == "dir") && ValidOwnerFolderName(name) &&
		ValidOwnerFileID(n.ID) && n.ID != sourceID &&
		ValidOwnerFileID(n.Revision) &&
		n.ParentID != nil && *n.ParentID == targetParent &&
		n.Type == kind && ValidOwnerFolderName(n.Name) && safeQuotaAmount(n.Size) &&
		!n.CreatedAt.IsZero() && !n.UpdatedAt.IsZero()
}

func (c *Client) OwnerCopyNode(ctx context.Context,
	sourceID, revision, sourceParent, targetParent uint64,
	kind, name string,
) (OwnerFileNode, error) {
	if c == nil || !hasCapability(c.capabilities, "cloud-node-copy") {
		return OwnerFileNode{}, errors.New("owning Agent does not support Server Owner node copy")
	}
	if !ValidOwnerFileID(sourceID) || !ValidOwnerFileID(revision) ||
		!ValidOwnerFileID(sourceParent) || !ValidOwnerFileID(targetParent) ||
		sourceID == targetParent || sourceParent == targetParent ||
		(kind != "file" && kind != "dir") || !ValidOwnerFolderName(name) {
		return OwnerFileNode{}, errors.New("invalid Server Owner copy selector")
	}
	var node client.Node
	// Existing Desktop Agent cloudCopy uses original Server Copy, which may
	// choose a nonconflicting name. DSM never accepts a native filesystem path.
	if err := c.request(ctx, http.MethodPost, "/v1/cloud/copy",
		map[string]any{"id": sourceID, "parent_id": targetParent}, &node); err != nil {
		return OwnerFileNode{}, err
	}
	projected, err := ownerFileNode(node, &targetParent)
	if err != nil || !ValidateOwnerCopiedNode(projected,
		sourceID, revision, sourceParent, targetParent, kind, name) {
		return OwnerFileNode{}, errors.New("unverified Server Owner copy acknowledgement")
	}
	return projected, nil
}
