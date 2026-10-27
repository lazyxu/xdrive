package localbackupipc

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
)

type OwnerThumbnail = client.OwnerThumbnail

func ValidateOwnerThumbnail(value OwnerThumbnail) bool {
	return client.ValidateOwnerThumbnail(value)
}

// Only the owning Agent's current Server session can return the actual
// derivative. The DSM process sees neither origin Server URL nor its bearer.
func (c *Client) OwnerFileThumbnail(
	ctx context.Context, id, revision uint64,
) (OwnerThumbnail, error) {
	if c == nil || !hasCapability(c.capabilities, "cloud-thumbnail-read") {
		return OwnerThumbnail{}, errors.New("owning Agent does not support Owner thumbnails")
	}
	if !ValidOwnerFileID(id) || !ValidOwnerFileID(revision) {
		return OwnerThumbnail{}, errors.New("invalid Owner thumbnail selector")
	}
	query := url.Values{
		"node_id":  {strconv.FormatUint(id, 10)},
		"revision": {strconv.FormatUint(revision, 10)},
	}
	var out OwnerThumbnail
	// 2 MiB derivative data encodes to <3 MiB base64 JSON; ordinary small
	// IPC requests keep the existing 1 MiB cap.
	if err := c.requestWithLimit(ctx, http.MethodGet,
		"/v1/cloud/thumbnail?"+query.Encode(), nil, &out, 4<<20); err != nil {
		return OwnerThumbnail{}, err
	}
	if !ValidateOwnerThumbnail(out) {
		return OwnerThumbnail{}, errors.New("unsafe or oversized Owner thumbnail projection")
	}
	return out, nil
}
