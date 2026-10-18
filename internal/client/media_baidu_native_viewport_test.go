package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBaiduNativeViewportRequiresExplicitBD09BeforeNetwork(t *testing.T) {
	c := &Client{}
	ok := BaiduNativeViewportBounds{
		CoordinateSpace: "bd09ll",
		West:            115, East: 118, South: 39, North: 42,
	}
	for _, test := range []struct {
		bounds        BaiduNativeViewportBounds
		limit, offset int
	}{
		{BaiduNativeViewportBounds{CoordinateSpace: "photo-wgs84", West: 115, East: 118, South: 39, North: 42}, 100, 0},
		{BaiduNativeViewportBounds{CoordinateSpace: "gcj02", West: 115, East: 118, South: 39, North: 42}, 100, 0},
		{BaiduNativeViewportBounds{CoordinateSpace: "bd09ll", West: 115, East: 115, South: 39, North: 42}, 100, 0},
		{BaiduNativeViewportBounds{CoordinateSpace: "bd09ll", West: 115, East: 118, South: -91, North: 42}, 100, 0},
		{ok, 101, 0},
		{ok, 0, 0},
		{ok, 1, 10000001},
	} {
		if _, err := c.BaiduNativeViewport(context.Background(), test.bounds, test.limit, test.offset); err == nil {
			t.Fatalf("invalid native viewport accepted: %+v", test)
		}
	}
}

func TestBaiduNativeViewportFixedOwnerPathAndCompleteCount(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet ||
			r.URL.Path != "/api/v1/media/places/baidu-jsapi/viewport" ||
			r.URL.Query().Get("west") != "179.5" ||
			r.URL.Query().Get("east") != "-179.5" ||
			r.URL.Query().Get("limit") != "1" ||
			r.URL.Query().Get("offset") != "0" ||
			r.URL.Query().Get("coordinate_space") != "" {
			t.Errorf("wrong path or query")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(BaiduNativeViewportPage{
			CoordinateSpace: "bd09ll", IndexScope: "explicit_opt_in_only",
			Items:      []BaiduNativeViewportPoint{{AssetID: 1, NodeID: 3, Latitude: 41, Longitude: 179.8}},
			TotalCount: 100001, Offset: 0, Limit: 1, HasMore: true,
		})
	}))
	defer upstream.Close()
	c := New(upstream.URL, "owner-token")
	got, err := c.BaiduNativeViewport(context.Background(), BaiduNativeViewportBounds{
		CoordinateSpace: "bd09ll", West: 179.5, East: -179.5,
		South: 40, North: 42,
	}, 1, 0)
	if err != nil || got.TotalCount != 100001 || !got.HasMore ||
		len(got.Items) != 1 || got.Items[0].NodeID != 3 {
		t.Fatalf("bounded native map transport lost count or identity: %+v %v", got, err)
	}
}

func TestBaiduNativeViewportRejectsUntrustedResponseCoordinateSpace(t *testing.T) {
	for _, wrong := range []string{"photo-wgs84", "gcj02"} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(BaiduNativeViewportPage{
				CoordinateSpace: wrong, IndexScope: "explicit_opt_in_only",
				Items: []BaiduNativeViewportPoint{}, TotalCount: 0,
				Limit: 1, Offset: 0, HasMore: false,
			})
		}))
		c := New(server.URL, "token")
		_, err := c.BaiduNativeViewport(context.Background(), BaiduNativeViewportBounds{
			CoordinateSpace: "bd09ll", West: 1, East: 2, South: 3, North: 4,
		}, 1, 0)
		server.Close()
		if err == nil {
			t.Fatalf("accepted spoofed %s map frame", wrong)
		}
	}
}
