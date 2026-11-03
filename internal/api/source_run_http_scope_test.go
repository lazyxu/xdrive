package api

import (
	"net/http"
	"testing"
)

func TestSourceRunHTTPAllowlistExcludesGeneralOwnerAndShareMutations(t *testing.T) {
	for _, tc := range []struct{ method, route string }{
		{http.MethodGet, "/api/v1/nodes/:id/children"},
		{http.MethodPost, "/api/v1/nodes/:id/directories"},
		{http.MethodPatch, "/api/v1/nodes/:id"},
		{http.MethodPost, "/api/v1/uploads"},
		{http.MethodPut, "/api/v1/uploads/:id/chunks/:index"},
		{http.MethodPost, "/api/v1/uploads/:id/finalize"},
		{http.MethodGet, "/api/v1/uploads/:id"},
	} {
		if !sourceRunHTTPAllowed(tc.method, tc.route) {
			t.Fatalf("worker ingestion route not allowed: %s %s", tc.method, tc.route)
		}
	}
	for _, tc := range []struct{ method, route string }{
		{http.MethodGet, "/api/v1/sources"},
		{http.MethodPatch, "/api/v1/sources/:id"},
		{http.MethodPost, "/api/v1/sources/:id/runs"},
		{http.MethodPost, "/api/v1/nodes/:id/copy"},
		{http.MethodDelete, "/api/v1/nodes/:id"},
		{http.MethodPost, "/api/v1/file-operations"},
		{http.MethodPost, "/api/v1/public/share/uploads"},
		{http.MethodPost, "/api/v1/shares"},
		{http.MethodGet, "/api/v1/files/:id/content"},
	} {
		if sourceRunHTTPAllowed(tc.method, tc.route) {
			t.Fatalf("SourceRun bearer escaped ingestion allowlist: %s %s", tc.method, tc.route)
		}
	}
}
