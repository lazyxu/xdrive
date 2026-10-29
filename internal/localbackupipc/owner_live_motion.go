package localbackupipc

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
)

type OwnerLiveMotion = client.OwnerLiveMotion

func ValidateOwnerLiveMotion(value OwnerLiveMotion, nodeID, revision uint64) bool {
	return client.ValidateOwnerLiveMotion(value, nodeID, revision)
}

func (c *Client) OwnerLiveMotion(ctx context.Context, nodeID, revision uint64) (OwnerLiveMotion, error) {
	if c == nil || !hasCapability(c.capabilities, "cloud-owner-live-motion-read") {
		return OwnerLiveMotion{}, errors.New("owning Agent Live Photo capability unavailable")
	}
	if nodeID == 0 || revision == 0 ||
		nodeID > client.OwnerLiveMotionMaxSafeID || revision > client.OwnerLiveMotionMaxSafeID {
		return OwnerLiveMotion{}, errors.New("invalid Owner Live Photo selector")
	}
	q := url.Values{"node_id": {strconv.FormatUint(nodeID, 10)}, "revision": {strconv.FormatUint(revision, 10)}}
	var out OwnerLiveMotion
	// 4 MiB raw motion is at most 5.6 MiB base64 + bounded metadata;
	// the shared 1 MiB ordinary IPC response cap remains unchanged.
	if err := c.requestWithLimit(ctx, http.MethodGet, "/v1/cloud/owner-live-motion?"+q.Encode(), nil, &out, 8<<20); err != nil {
		return OwnerLiveMotion{}, err
	}
	if !ValidateOwnerLiveMotion(out, nodeID, revision) {
		return OwnerLiveMotion{}, errors.New("invalid Owner Live Photo response")
	}
	return out, nil
}
