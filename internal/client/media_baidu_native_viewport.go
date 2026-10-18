package client

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/url"
	"strconv"
)

// A3c13: native Baidu viewport coordinates are BD09LL, NOT original photo
// WGS84. A caller must explicitly tag the space to prevent silent relabeling.
type BaiduNativeViewportBounds struct {
	CoordinateSpace string  `json:"coordinate_space"`
	West            float64 `json:"west"`
	South           float64 `json:"south"`
	East            float64 `json:"east"`
	North           float64 `json:"north"`
}

type BaiduNativeViewportPoint struct {
	AssetID   uint64  `json:"asset_id"`
	NodeID    uint64  `json:"node_id"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type BaiduNativeViewportPage struct {
	CoordinateSpace string                     `json:"coordinate_space"`
	IndexScope      string                     `json:"index_scope"`
	Items           []BaiduNativeViewportPoint `json:"items"`
	TotalCount      int64                      `json:"total_count"`
	Offset          int                        `json:"offset"`
	Limit           int                        `json:"limit"`
	HasMore         bool                       `json:"has_more"`
}

var errBaiduNativeViewport = errors.New("invalid BD09 map viewport")

func (b BaiduNativeViewportBounds) valid() bool {
	if b.CoordinateSpace != "bd09ll" ||
		b.West < -180 || b.West > 180 || b.East < -180 || b.East > 180 ||
		b.South < -90 || b.North > 90 || b.South >= b.North ||
		b.West == b.East || b.West == 180 && b.East == -180 {
		return false
	}
	for _, v := range []float64{b.West, b.South, b.East, b.North} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return true
}

// Only the fixed Owner API path is permitted. No arbitrary URL or AK from a
// renderer is forwarded. Server independently verifies signed release,
// Bearer/Owner/session/revocation and the source-bound per-photo opt-in index.
func (c *Client) BaiduNativeViewport(ctx context.Context,
	bounds BaiduNativeViewportBounds, limit, offset int,
) (BaiduNativeViewportPage, error) {
	var out BaiduNativeViewportPage
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
	}
	err := c.json(ctx, http.MethodGet,
		"/api/v1/media/places/baidu-jsapi/viewport?"+q.Encode(), nil, &out)
	if err != nil {
		return BaiduNativeViewportPage{}, err
	}
	if out.CoordinateSpace != "bd09ll" ||
		out.IndexScope != "explicit_opt_in_only" ||
		out.Limit != limit || out.Offset != offset ||
		out.TotalCount < 0 || len(out.Items) > limit ||
		out.HasMore != (out.TotalCount > int64(offset)+int64(len(out.Items))) {
		return BaiduNativeViewportPage{}, errBaiduNativeViewport
	}
	return out, nil
}
