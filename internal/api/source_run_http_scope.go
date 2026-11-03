package api

import "net/http"

// A signed SourceRun bearer is not a general Owner session. Its access token
// format is compatible with existing client HTTP, but it may call only the
// file-ingestion routes required by an active Pull/NAS Push executor.
// Each mutating route additionally validates the exact SourceRun/Target.
func sourceRunHTTPAllowed(method, route string) bool {
	switch method {
	case http.MethodGet:
		switch route {
		case "/api/v1/me/quota",
			"/api/v1/nodes/root",
			"/api/v1/nodes/:id",
			"/api/v1/nodes/:id/children",
			"/api/v1/uploads/:id":
			return true
		}
	case http.MethodPost:
		switch route {
		case "/api/v1/nodes/:id/directories",
			"/api/v1/nodes/:id/files",
			"/api/v1/uploads/preflight",
			"/api/v1/uploads/preflight/batch",
			"/api/v1/uploads",
			"/api/v1/uploads/:id/finalize":
			return true
		}
	case http.MethodPatch:
		return route == "/api/v1/nodes/:id"
	case http.MethodPut:
		switch route {
		case "/api/v1/files/:id/content", "/api/v1/uploads/:id/chunks/:index":
			return true
		}
	case http.MethodDelete:
		return route == "/api/v1/uploads/:id"
	}
	return false
}
