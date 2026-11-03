package api

import "net/http"

// A signed active SourceRun bearer can only use these ingestion routes.
// Every mutation is rechecked against the SourceID/RunID, Source Revision,
// target Node ancestry and current run status in the write transaction.
func sourceRunHTTPAllowed(method, route string) bool {
	switch method {
	case http.MethodGet:
		switch route {
		case "/api/v1/me/quota", "/api/v1/nodes/root", "/api/v1/nodes/:id",
			"/api/v1/nodes/:id/children", "/api/v1/uploads/:id":
			return true
		}
	case http.MethodPost:
		switch route {
		case "/api/v1/nodes/:id/directories", "/api/v1/uploads",
			"/api/v1/uploads/preflight", "/api/v1/uploads/preflight/batch",
			"/api/v1/uploads/:id/finalize":
			return true
		}
	case http.MethodPatch:
		return route == "/api/v1/nodes/:id"
	case http.MethodPut:
		return route == "/api/v1/uploads/:id/chunks/:index"
	case http.MethodDelete:
		return route == "/api/v1/uploads/:id"
	}
	return false
}
