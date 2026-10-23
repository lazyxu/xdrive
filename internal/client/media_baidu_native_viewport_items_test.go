package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBD09ViewportPhotoRangeFixedAuthenticatedEndpoint(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if r.Method != "GET" || r.URL.Path != "/api/v1/media/places/baidu-jsapi/viewport-items" ||
			q.Get("west") != "179.5" || q.Get("east") != "-179.5" || q.Get("range") != "true" ||
			q.Get("offset") != "0" || q.Get("limit") != "1" || q.Get("kind") != "video" ||
			q.Get("sort_by") != "captured" || q.Get("coordinate_space") != "" ||
			q.Get("favorite") != "true" || q.Get("time_zone") != "Asia/Tokyo" {
			t.Errorf("wrong signed Owner camera request: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(MediaItemRange{
			Items:      []MediaItem{{Node: Node{ID: 7, Name: "m.mp4", Type: "file"}}},
			TotalCount: 100000, Offset: 0, Limit: 1,
		})
	}))
	defer upstream.Close()
	yes := true
	c := New(upstream.URL, "test_owner")
	out, err := c.BaiduNativeViewportItems(context.Background(), BaiduNativeViewportBounds{
		CoordinateSpace: "bd09ll", West: 179.5, East: -179.5, South: 39, North: 40,
	}, 1, 0, BaiduNativeViewportItemsFilter{
		Favorite: &yes, TimeZone: "Asia/Tokyo", MediaKind: "video", SortBy: "captured",
	})
	if err != nil || out.TotalCount != 100000 || len(out.Items) != 1 || out.Items[0].Node.ID != 7 {
		t.Fatalf("camera Range mismatch: %+v: %v", out, err)
	}
}
func TestBD09ViewportPhotoRangeFailClosed(t *testing.T) {
	c := &Client{}
	b := BaiduNativeViewportBounds{CoordinateSpace: "bd09ll", West: 116, East: 117, South: 39, North: 40}
	for _, tc := range []struct {
		bounds        BaiduNativeViewportBounds
		filter        BaiduNativeViewportItemsFilter
		limit, offset int
	}{
		{BaiduNativeViewportBounds{CoordinateSpace: "wgs84", West: 116, East: 117, South: 39, North: 40}, BaiduNativeViewportItemsFilter{}, 1, 0},
		{b, BaiduNativeViewportItemsFilter{MediaKind: "live_photo"}, 1, 0},
		{b, BaiduNativeViewportItemsFilter{SortBy: "distance"}, 1, 0},
		{b, BaiduNativeViewportItemsFilter{TimeZone: "\x00secret"}, 1, 0},
		{b, BaiduNativeViewportItemsFilter{}, 101, 0},
		{b, BaiduNativeViewportItemsFilter{}, 1, 10000001},
	} {
		if _, err := c.BaiduNativeViewportItems(context.Background(), tc.bounds, tc.limit, tc.offset, tc.filter); err == nil {
			t.Fatalf("invalid BD09 camera Range accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.BaiduNativeViewportItems(ctx, b, 1, 0, BaiduNativeViewportItemsFilter{}); err == nil {
		t.Fatal("cancelled camera read accepted")
	}
}
