package localbackupipc

import (
	"context"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
)

// The JSON payload is at most 256 KiB binary (base64 encoded by encoding/json).
// Neither credential, Server URL, ticket, CAS key nor NAS path is projected.
type OwnerMediaRange = client.OwnerMediaRange

func ValidateOwnerMediaRange(value OwnerMediaRange, offset int64, length int, revision uint64) bool {
	digest, err := hex.DecodeString(value.SHA256)
	if err != nil || len(digest) != 32 || strings.ToLower(value.SHA256) != value.SHA256 {
		return false
	}
	return ValidOwnerFileID(revision) && value.Revision == revision &&
		offset >= 0 && uint64(offset) <= MaxSafeSourceID &&
		length >= 1 && length <= client.OwnerMediaRangeMaxBytes &&
		value.Offset == offset && value.Total > offset && uint64(value.Total) <= MaxSafeSourceID &&
		len(value.Data) >= 1 && len(value.Data) <= length &&
		int64(len(value.Data)) <= value.Total-offset &&
		(len(value.Data) == length || offset+int64(len(value.Data)) == value.Total)
}

func (c *Client) OwnerFileMediaRange(
	ctx context.Context, nodeID, revision uint64, offset int64, length int,
) (OwnerMediaRange, error) {
	if c == nil || !hasCapability(c.capabilities, "cloud-media-range-read") {
		return OwnerMediaRange{}, errors.New("owning Agent does not support immutable Owner range")
	}
	if !ValidOwnerFileID(nodeID) || !ValidOwnerFileID(revision) ||
		offset < 0 || uint64(offset) > MaxSafeSourceID ||
		length < 1 || length > client.OwnerMediaRangeMaxBytes {
		return OwnerMediaRange{}, errors.New("invalid Owner media range selector")
	}
	q := url.Values{
		"node_id":  {strconv.FormatUint(nodeID, 10)},
		"revision": {strconv.FormatUint(revision, 10)},
		"offset":   {strconv.FormatInt(offset, 10)},
		"length":   {strconv.Itoa(length)},
	}
	var out OwnerMediaRange
	if err := c.request(ctx, http.MethodGet, "/v1/cloud/media-range?"+q.Encode(), nil, &out); err != nil {
		return OwnerMediaRange{}, err
	}
	if !ValidateOwnerMediaRange(out, offset, length, revision) {
		return OwnerMediaRange{}, errors.New("invalid Owner media range projection")
	}
	return out, nil
}
