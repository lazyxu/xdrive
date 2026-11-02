package localbackupipc

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
)

type OwnerViewerPreviewRange = client.OwnerViewerPreviewRange

func ValidOwnerViewerPreviewRange(part OwnerViewerPreviewRange, id, revision uint64,
	format string, offset int64, length int) bool {
	return client.ValidOwnerViewerPreviewRange(part, id, revision, format, offset, length)
}

// Bounded JSON envelope remains below the existing 1 MiB local IPC limit.
// Owners are authenticated by the Agent on every immutable slice.
func (c *Client) OwnerFileViewerPreviewRange(ctx context.Context,
	id, revision uint64, format string, offset int64, length int,
) (OwnerViewerPreviewRange, error) {
	var zero OwnerViewerPreviewRange
	if c == nil || !hasCapability(c.capabilities, "cloud-viewer-preview-read") ||
		!ValidOwnerFileID(id) || !ValidOwnerFileID(revision) ||
		(format != "webp" && format != "jpeg") ||
		offset < 0 || offset >= client.OwnerViewerPreviewMaxBytes ||
		length < 1 || length > client.OwnerViewerPreviewChunkBytes {
		return zero, errors.New("Owner Viewer preview capability or selector unavailable")
	}
	query := url.Values{
		"node_id":  {strconv.FormatUint(id, 10)},
		"revision": {strconv.FormatUint(revision, 10)},
		"format":   {format},
		"offset":   {strconv.FormatInt(offset, 10)},
		"length":   {strconv.Itoa(length)},
	}
	var out OwnerViewerPreviewRange
	if err := c.request(ctx, http.MethodGet,
		"/v1/cloud/viewer-preview?"+query.Encode(), nil, &out); err != nil {
		return zero, err
	}
	if !ValidOwnerViewerPreviewRange(out, id, revision, format, offset, length) {
		return zero, errors.New("invalid authenticated Owner Viewer image chunk")
	}
	return out, nil
}
