package localbackupipc

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/client"
)

// OwnerTextPreview contains only the existing Server Owner-authorized,
// bounded text projection. It is not an original byte stream or signed URL.
type OwnerTextPreview struct {
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"`
	Size      int64  `json:"size"`
}

const maxOwnerTextPreviewBytes = 1 << 20

func ValidateOwnerTextPreview(preview OwnerTextPreview) bool {
	return safeQuotaAmount(preview.Size) &&
		len(preview.Text) <= maxOwnerTextPreviewBytes &&
		utf8.ValidString(preview.Text)
}

// OwnerFileTextPreview uses only the original Agent's authenticated Server
// account. DSM never chooses a Server URL, path, token or filesystem Root.
func (c *Client) OwnerFileTextPreview(ctx context.Context, nodeID uint64) (OwnerTextPreview, error) {
	if c == nil || !hasCapability(c.capabilities, "cloud-file-text-preview") {
		return OwnerTextPreview{}, errors.New("owning Agent does not support bounded Owner text preview")
	}
	if !ValidOwnerFileID(nodeID) {
		return OwnerTextPreview{}, errors.New("invalid Owner text preview node ID")
	}
	q := url.Values{"id": {strconv.FormatUint(nodeID, 10)}}
	var server client.FileTextPreview
	// JSON escaping can enlarge an otherwise <=1 MiB UTF-8 text projection.
	// This route alone has an 8 MiB transport cap; decoded content is still
	// restricted to 1 MiB before the DSM response can be constructed.
	if err := c.requestWithLimit(
		ctx, http.MethodGet, "/v1/cloud/text-preview?"+q.Encode(),
		nil, &server, 8<<20,
	); err != nil {
		return OwnerTextPreview{}, err
	}
	out := OwnerTextPreview{
		Text: server.Text, Truncated: server.Truncated, Size: server.Size,
	}
	if !ValidateOwnerTextPreview(out) {
		return OwnerTextPreview{}, errors.New("invalid or oversized Server Owner text projection")
	}
	return out, nil
}
