package client

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
)

// OwnerMediaRange is one strictly verified immutable revision slice. It is a
// bounded representation for an authenticated, local-Agent-controlled reader,
// never a signed URL, CAS path, or generic upstream proxy.
type OwnerMediaRange struct {
	Offset   int64  `json:"offset"`
	Total    int64  `json:"total"`
	Revision uint64 `json:"revision"`
	SHA256   string `json:"sha256"`
	Data     []byte `json:"data"`
}

const OwnerMediaRangeMaxBytes = 256 << 10

// DownloadVerifiedRange rejects ignored Range requests, weak/missing ETags,
// incorrect Content-Range, short bodies and stale revisions. The pre-existing
// DownloadRangeInto method is not sufficient for media/viewer byte assembly
// because it accepts HTTP 200 and might serve the wrong offset.
func (c *Client) DownloadVerifiedRange(
	ctx context.Context, nodeID, revision uint64, offset int64, length int,
) (OwnerMediaRange, error) {
	if c == nil || ctx == nil || nodeID == 0 || revision == 0 ||
		offset < 0 || length < 1 || length > OwnerMediaRangeMaxBytes ||
		offset > math.MaxInt64-int64(length) {
		return OwnerMediaRange{}, errors.New("invalid verified Owner range")
	}
	path := fmt.Sprintf("/api/v1/files/%d/content", nodeID)
	req, err := c.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return OwnerMediaRange{}, err
	}
	end := offset + int64(length) - 1
	etag := fmt.Sprintf("\"%d\"", revision)
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", offset, end))
	req.Header.Set("If-Range", etag)
	resp, err := c.do(req)
	if err != nil {
		return OwnerMediaRange{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent || resp.Header.Get("ETag") != etag {
		return OwnerMediaRange{}, errors.New("Server ignored range or Owner file revision changed")
	}
	// Bind consecutive requests to identical immutable content, including a
	// login/Owner switch that happens to reuse the same numeric ID/revision.
	// The existing Server sends its CAS digest for each authenticated file.
	sha := strings.TrimSpace(resp.Header.Get("X-Content-SHA256"))
	parsedDigest, digestErr := hex.DecodeString(sha)
	if digestErr != nil || len(parsedDigest) != 32 ||
		sha != strings.ToLower(sha) {
		return OwnerMediaRange{}, errors.New("missing or invalid Owner content identity")
	}
	// RFC 9110: single canonical byte range response, never multipart or '*'.
	raw := strings.TrimSpace(resp.Header.Get("Content-Range"))
	if !strings.HasPrefix(raw, "bytes ") {
		return OwnerMediaRange{}, errors.New("missing Owner Content-Range")
	}
	parts := strings.Split(strings.TrimPrefix(raw, "bytes "), "/")
	if len(parts) != 2 {
		return OwnerMediaRange{}, errors.New("invalid Owner Content-Range")
	}
	bounds := strings.Split(parts[0], "-")
	if len(bounds) != 2 {
		return OwnerMediaRange{}, errors.New("invalid Owner Content-Range bounds")
	}
	start, errStart := strconv.ParseInt(bounds[0], 10, 64)
	last, errLast := strconv.ParseInt(bounds[1], 10, 64)
	total, errTotal := strconv.ParseInt(parts[1], 10, 64)
	if errStart != nil || errLast != nil || errTotal != nil ||
		start != offset || last < start || last > end ||
		total <= last || total <= 0 ||
		fmt.Sprintf("bytes %d-%d/%d", start, last, total) != raw {
		return OwnerMediaRange{}, errors.New("mismatched Owner Content-Range")
	}
	size := last - start + 1
	if size <= 0 || size > int64(length) || resp.ContentLength != size {
		return OwnerMediaRange{}, errors.New("incorrect Owner range Content-Length")
	}
	data := make([]byte, int(size))
	if _, err := io.ReadFull(resp.Body, data); err != nil {
		return OwnerMediaRange{}, fmt.Errorf("incomplete verified Owner range: %w", err)
	}
	var extra [1]byte
	if n, err := resp.Body.Read(extra[:]); n != 0 || err != io.EOF {
		return OwnerMediaRange{}, errors.New("unexpected bytes after Owner range")
	}
	return OwnerMediaRange{Offset: start, Total: total, Revision: revision, SHA256: sha, Data: data}, nil
}
