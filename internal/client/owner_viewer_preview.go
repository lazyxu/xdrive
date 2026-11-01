package client

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// One bounded, immutable, current-Owner range of a *derived* 4096px image.
// The canonical HEIC/JPEG/LIVP object is never sent through this projection.
// Every range is individually reauthorized by the Server and revision-fenced.
const (
	OwnerViewerPreviewChunkBytes = 256 << 10
	OwnerViewerPreviewMaxBytes   = 64 << 20
)

type OwnerViewerPreviewRange struct {
	NodeID   uint64 `json:"node_id"`
	Revision uint64 `json:"revision"`
	Format   string `json:"format"`
	Offset   int64  `json:"offset"`
	Total    int64  `json:"total"`
	ETag     string `json:"etag"`
	Data     []byte `json:"data"`
}

func validOwnerViewerPreviewETag(etag string, nodeID, revision uint64, format string) bool {
	if len(etag) < 30 || !strings.HasPrefix(etag, "\"media-viewer:") ||
		!strings.HasSuffix(etag, ":v1\"") {
		return false
	}
	parts := strings.Split(strings.Trim(etag, "\""), ":")
	if len(parts) != 6 || parts[0] != "media-viewer" ||
		parts[2] != strconv.FormatUint(nodeID, 10) ||
		parts[3] != strconv.FormatUint(revision, 10) ||
		parts[4] != format || parts[5] != "v1" {
		return false
	}
	sha := parts[1]
	if sha != "" {
		if len(sha) != 64 {
			return false
		}
		for _, r := range sha {
			if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
				return false
			}
		}
	}
	return true
}

func ValidOwnerViewerPreviewRange(value OwnerViewerPreviewRange, nodeID, revision uint64,
	format string, offset int64, length int) bool {
	if nodeID == 0 || revision == 0 || nodeID > 1<<53-1 || revision > 1<<53-1 ||
		(format != "webp" && format != "jpeg") ||
		offset < 0 || offset >= OwnerViewerPreviewMaxBytes ||
		length < 1 || length > OwnerViewerPreviewChunkBytes {
		return false
	}
	return value.NodeID == nodeID && value.Revision == revision && value.Format == format &&
		value.Offset == offset && value.Total > offset &&
		value.Total <= OwnerViewerPreviewMaxBytes &&
		len(value.Data) > 0 && len(value.Data) <= length &&
		int64(len(value.Data)) <= value.Total-offset &&
		(len(value.Data) == length || offset+int64(len(value.Data)) == value.Total) &&
		validOwnerViewerPreviewETag(value.ETag, nodeID, revision, format)
}

func (c *Client) MediaOwnerViewerPreviewRange(ctx context.Context,
	nodeID, revision uint64, format string, offset int64, length int,
) (OwnerViewerPreviewRange, error) {
	var zero OwnerViewerPreviewRange
	if !ValidOwnerViewerPreviewRange(OwnerViewerPreviewRange{
		NodeID: nodeID, Revision: revision, Format: format, Offset: offset,
		Total: offset + int64(length), ETag: fmt.Sprintf(
			"\"media-viewer::%d:%d:%s:v1\"", nodeID, revision, format,
		), Data: make([]byte, length),
	}, nodeID, revision, format, offset, length) {
		return zero, errors.New("invalid Owner Viewer preview selector")
	}
	path := fmt.Sprintf("/api/v1/media/items/%d/viewer-preview?format=%s&revision=%d",
		nodeID, format, revision)
	req, err := c.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return zero, err
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", offset, offset+int64(length)-1))
	resp, err := c.do(req)
	if err != nil {
		return zero, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent {
		return zero, fmt.Errorf("Owner Viewer preview range unavailable (HTTP %d)", resp.StatusCode)
	}
	expectedMIME := "image/webp"
	if format == "jpeg" {
		expectedMIME = "image/jpeg"
	}
	if strings.ToLower(strings.TrimSpace(strings.SplitN(resp.Header.Get("Content-Type"), ";", 2)[0])) != expectedMIME {
		return zero, errors.New("Owner Viewer preview MIME mismatch")
	}
	// No open-ended or multipart ranges are accepted; exact start/end/total
	// and the revision-bound ETag must agree across every separate request.
	var first, last, total int64
	rawRange := resp.Header.Get("Content-Range")
	if _, err := fmt.Sscanf(rawRange, "bytes %d-%d/%d", &first, &last, &total); err != nil ||
		fmt.Sprintf("bytes %d-%d/%d", first, last, total) != rawRange ||
		first != offset || last < first ||
		last >= total || last-offset+1 > int64(length) {
		return zero, errors.New("invalid Owner Viewer preview Content-Range")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, int64(length)+1))
	if err != nil || len(data) == 0 || len(data) > length ||
		int64(len(data)) != last-first+1 ||
		(resp.ContentLength >= 0 && resp.ContentLength != int64(len(data))) {
		return zero, errors.New("invalid Owner Viewer preview bounded body")
	}
	value := OwnerViewerPreviewRange{NodeID: nodeID, Revision: revision,
		Format: format, Offset: offset, Total: total,
		ETag: resp.Header.Get("ETag"), Data: data}
	if !ValidOwnerViewerPreviewRange(value, nodeID, revision, format, offset, length) {
		return zero, errors.New("Owner Viewer preview revision/ETag/length mismatch")
	}
	return value, nil
}
