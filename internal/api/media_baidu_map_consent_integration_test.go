package api

import "testing"

// Legacy media-map consent endpoints are intentionally not registered.
// Valid Owner GPS automatically qualifies for a map derivative; this does
// not remove ordinary auth, source revision checks or SDK Origin isolation.
func TestMediaPhotoMapHasNoExtraConsentOrManualGrantRoutes(t *testing.T) {
	routes := (&Server{}).Router().Routes()
	present := make(map[string]bool, len(routes))
	for _, route := range routes {
		present[route.Method+" "+route.Path] = true
	}
	for _, path := range []string{
		"GET /api/v1/media/items/:id/baidu-map-consent",
		"PUT /api/v1/media/items/:id/baidu-map-consent",
		"DELETE /api/v1/media/items/:id/baidu-map-consent",
		"POST /api/v1/media/items/:id/baidu-map-index-job",
		"DELETE /api/v1/media/items/:id/baidu-map-index-job",
	} {
		if present[path] {
			t.Fatalf("retired map authorization/mutating route is still published: %s", path)
		}
	}
	for _, path := range []string{
		"GET /api/v1/media/places/baidu-jsapi/coverage",
		"GET /api/v1/media/places/baidu-jsapi/cells",
		"GET /api/v1/media/places/baidu-jsapi/viewport",
	} {
		if !present[path] {
			t.Fatalf("Owner map read contract was accidentally retired: %s", path)
		}
	}
}
