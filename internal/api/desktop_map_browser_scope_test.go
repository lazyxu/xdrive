package api

import (
	"net/http"
	"testing"
)

func TestDesktopMapBrowserHTTPAllowed(t *testing.T) {
	allowed := []struct{ method, route string }{
		{http.MethodGet, "/api/v1/me"},
		{http.MethodGet, "/api/v1/media/facets"},
		{http.MethodGet, "/api/v1/media/albums"},
		{http.MethodGet, "/api/v1/media/albums/:albumID/items"},
		{http.MethodGet, "/api/v1/media/places/baidu-jsapi/cells"},
		{http.MethodGet, "/api/v1/media/places/baidu-jsapi/cell-items"},
		{http.MethodGet, "/api/v1/media/items/:id/thumbnail"},
		{http.MethodGet, "/api/v1/media/items/:id/viewer-preview"},
		{http.MethodPost, "/api/v1/media/places/baidu-jsapi/scope-handoff"},
		{http.MethodPost, "/api/v1/media/places/baidu-jsapi/child-ticket"},
	}
	for _, tt := range allowed {
		if !desktopMapBrowserHTTPAllowed(tt.method, tt.route) {
			t.Errorf("map guest lost authorized route %s %s", tt.method, tt.route)
		}
	}
	denied := []struct{ method, route string }{
		{http.MethodGet, "/api/v1/nodes"},
		{http.MethodGet, "/api/v1/files/:id/content"},
		{http.MethodGet, "/api/v1/notes"},
		{http.MethodGet, "/api/v1/clipboard"},
		{http.MethodGet, "/api/v1/admin/users"},
		{http.MethodGet, "/api/v1/media/trash"},
		{http.MethodPost, "/api/v1/auth/desktop-map/issue"},
		{http.MethodPost, "/api/v1/media/albums"},
		{http.MethodPatch, "/api/v1/media/items/:id/favorite"},
		{http.MethodDelete, "/api/v1/media/albums/:albumID"},
		{http.MethodPost, "/api/v1/uploads"},
		{http.MethodPost, "/api/v1/sources/:id/runs"},
		{http.MethodGet, "/api/v1/media/places/baidu-jsapi/cells/anything"},
		{http.MethodGet, "/api/v1/media/places/baidu-jsapi/cells%2F..%2F.."},
		{http.MethodGet, ""},
	}
	for _, tt := range denied {
		if desktopMapBrowserHTTPAllowed(tt.method, tt.route) {
			t.Errorf("map guest was granted unrelated route %s %s", tt.method, tt.route)
		}
	}
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		if desktopMapBrowserHTTPAllowed(method, "/api/v1/media/places/baidu-jsapi/cells") {
			t.Errorf("map Cells must remain read-only for %s", method)
		}
	}
}
