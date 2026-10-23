package api

import "testing"

// Static PNG and map-provider endpoints are retired. No route may revive them.
func TestBaiduImageMapRoutesRetired(t *testing.T) {
	routes := (&Server{}).Router().Routes()
	retired := map[string]bool{
		"GET /api/v1/media/places/map-provider":        true,
		"GET /api/v1/media/places/baidu-static":        true,
		"POST /api/v1/admin/services/baidu-map/verify": true,
	}
	for _, route := range routes {
		if retired[route.Method+" "+route.Path] {
			t.Fatalf("retired static-map route registered: %s %s", route.Method, route.Path)
		}
	}
}
