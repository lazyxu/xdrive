package api

import "net/http"

// desktopMapBrowserHTTPAllowed narrows an Agent-redeemed browser JWT to the
// read-only Gallery/Places surface plus the one-use map mode handoffs.
// Use Gin's registered FullPath, not an attacker-controlled raw URL prefix:
// a route added later must be explicitly reviewed before a map bearer can use it.
// This is an additional boundary; Owner/album/PhotoScope and map-epoch checks
// continue to run in the individual handlers.
func desktopMapBrowserHTTPAllowed(method, registeredRoute string) bool {
	switch method {
	case http.MethodGet, http.MethodHead:
		switch registeredRoute {
		case "/api/v1/me",
			"/api/v1/me/quota",
			"/api/v1/me/viewer-quality",
			"/api/v1/media/items",
			"/api/v1/media/items/:id",
			"/api/v1/media/items/:id/thumbnail",
			"/api/v1/media/items/:id/viewer-preview",
			"/api/v1/media/items/:id/analysis-preview",
			"/api/v1/media/items/:id/resources/:role",
			"/api/v1/media/items/:id/live-photo-motion",
			"/api/v1/media/content/:contentKey",
			"/api/v1/media/content/:contentKey/sources",
			"/api/v1/media/facets",
			"/api/v1/media/index-status",
			"/api/v1/media/albums",
			"/api/v1/media/albums/:albumID/items",
			"/api/v1/media/album-folders",
			"/api/v1/media/places",
			"/api/v1/media/places/page",
			"/api/v1/media/places/hierarchy",
			"/api/v1/media/places/viewport",
			"/api/v1/media/places/overview",
			"/api/v1/media/places/baidu-jsapi/status",
			"/api/v1/media/places/baidu-jsapi/prototype",
			"/api/v1/media/places/baidu-jsapi/coverage",
			"/api/v1/media/places/baidu-jsapi/coverage-reasons",
			"/api/v1/media/places/baidu-jsapi/viewport",
			"/api/v1/media/places/baidu-jsapi/photo-focus",
			"/api/v1/media/places/baidu-jsapi/cells",
			"/api/v1/media/places/baidu-jsapi/cell-items",
			"/api/v1/media/places/baidu-jsapi/viewport-items":
			return true
		}
	case http.MethodPost:
		switch registeredRoute {
		case "/api/v1/media/places/baidu-jsapi/session",
			"/api/v1/media/places/baidu-jsapi/child-ticket",
			"/api/v1/media/places/baidu-jsapi/scope-handoff",
			"/api/v1/media/places/baidu-jsapi/scope-handoff/consume":
			return true
		}
	}
	return false
}
