package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// BaiduNativeViewportItemsFilter is deliberately smaller than MediaQuery.
// An Agent must never forward normal /media/items filters or a WGS84 bbox
// into this signed Owner/Consent/SourceRevision BD09 viewport Range.
type BaiduNativeViewportItemsFilter struct {
	SortBy       string
	SortDir      string
	AnchorNodeID uint64
	Favorite     *bool
	CapturedFrom string
	CapturedTo   string
	TimeZone     string
	MediaKind    string
}

func (f BaiduNativeViewportItemsFilter) add(q url.Values) error {
	if f.SortBy != "" && f.SortBy != "captured" && f.SortBy != "added" {
		return errBaiduNativeViewport
	}
	if f.SortDir != "" && f.SortDir != "asc" && f.SortDir != "desc" {
		return errBaiduNativeViewport
	}
	if f.MediaKind != "" && f.MediaKind != "image" && f.MediaKind != "video" {
		return errBaiduNativeViewport
	}
	if f.SortBy != "" {
		q.Set("sort_by", f.SortBy)
	}
	if f.SortDir != "" {
		q.Set("sort_dir", f.SortDir)
	}
	if f.AnchorNodeID != 0 {
		q.Set("anchor_node_id", strconv.FormatUint(f.AnchorNodeID, 10))
	}
	if f.Favorite != nil {
		q.Set("favorite", strconv.FormatBool(*f.Favorite))
	}
	for _, item := range []struct{ key, value string }{
		{"captured_from", f.CapturedFrom}, {"captured_to", f.CapturedTo},
		{"time_zone", f.TimeZone}, {"kind", f.MediaKind},
	} {
		if item.value == "" {
			continue
		}
		if len(item.value) > 128 || strings.TrimSpace(item.value) != item.value ||
			strings.ContainsAny(item.value, "\x00\r\n") {
			return errBaiduNativeViewport
		}
		q.Set(item.key, item.value)
	}
	return nil
}

// BaiduNativeViewportItems returns only the complete, sparse, logical media
// Range for a BD09 camera. Never substitute /media/items on a missing route.
func (c *Client) BaiduNativeViewportItems(
	ctx context.Context, bounds BaiduNativeViewportBounds,
	limit, offset int, filter BaiduNativeViewportItemsFilter,
) (MediaItemRange, error) {
	var out MediaItemRange
	if ctx == nil || ctx.Err() != nil || !bounds.valid() ||
		limit < 1 || limit > 100 || offset < 0 || offset > 10000000 {
		return out, errBaiduNativeViewport
	}
	q := url.Values{
		"west":   {strconv.FormatFloat(bounds.West, 'g', -1, 64)},
		"south":  {strconv.FormatFloat(bounds.South, 'g', -1, 64)},
		"east":   {strconv.FormatFloat(bounds.East, 'g', -1, 64)},
		"north":  {strconv.FormatFloat(bounds.North, 'g', -1, 64)},
		"limit":  {strconv.Itoa(limit)},
		"offset": {strconv.Itoa(offset)},
		"range":  {"true"},
	}
	if err := filter.add(q); err != nil {
		return out, err
	}
	if err := c.json(ctx, http.MethodGet,
		"/api/v1/media/places/baidu-jsapi/viewport-items?"+q.Encode(), nil, &out); err != nil {
		return MediaItemRange{}, err
	}
	if ctx.Err() != nil || out.Limit != limit || out.Offset != offset ||
		out.TotalCount < 0 || len(out.Items) > limit ||
		int64(offset)+int64(len(out.Items)) > out.TotalCount {
		return MediaItemRange{}, errBaiduNativeViewport
	}
	if out.AnchorIndex != nil && (*out.AnchorIndex < 0 || *out.AnchorIndex >= out.TotalCount) {
		return MediaItemRange{}, errBaiduNativeViewport
	}
	seen := make(map[uint64]bool, len(out.Items))
	for _, item := range out.Items {
		if item.Node.ID == 0 || seen[item.Node.ID] {
			return MediaItemRange{}, fmt.Errorf("%w: duplicate or invalid media", errBaiduNativeViewport)
		}
		seen[item.Node.ID] = true
	}
	return out, nil
}
