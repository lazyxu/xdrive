package api

import (
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

type apiRouteCoverage struct {
	method string
	path   string
	suite  string
}

func TestEveryRegisteredAPIEndpointIsInCoverageManifest(t *testing.T) {
	gin.SetMode(gin.TestMode)

	coverage := []apiRouteCoverage{
		{method: "GET", path: "/metrics", suite: "observability"},
		{method: "GET", path: "/api/v1/healthz", suite: "observability"},
		{method: "GET", path: "/api/v1/readyz", suite: "observability"},
		{method: "GET", path: "/api/v1/version", suite: "version"},
		{method: "POST", path: "/api/v1/auth/login", suite: "auth"},
		{method: "POST", path: "/api/v1/auth/refresh", suite: "auth"},
		{method: "POST", path: "/api/v1/auth/logout", suite: "auth"},
		{method: "GET", path: "/api/v1/public/share", suite: "shares"},
		{method: "POST", path: "/api/v1/public/share/download", suite: "shares"},
		{method: "GET", path: "/api/v1/me", suite: "account"},
		{method: "GET", path: "/api/v1/me/quota", suite: "quota"},
		{method: "GET", path: "/api/v1/me/storage", suite: "storage-intelligence"},
		{method: "GET", path: "/api/v1/search", suite: "search"},
		{method: "GET", path: "/api/v1/changes", suite: "changes"},
		{method: "POST", path: "/api/v1/me/change-password", suite: "account"},
		{method: "GET", path: "/api/v1/nodes/root", suite: "nodes"},
		{method: "GET", path: "/api/v1/nodes/:id/children", suite: "nodes"},
		{method: "GET", path: "/api/v1/file-quick-access", suite: "quick-access"},
		{method: "PUT", path: "/api/v1/file-quick-access/:id", suite: "quick-access"},
		{method: "DELETE", path: "/api/v1/file-quick-access/:id", suite: "quick-access"},
		{method: "GET", path: "/api/v1/file-recent", suite: "recent"},
		{method: "GET", path: "/api/v1/background-tasks", suite: "background-tasks"},
		{method: "POST", path: "/api/v1/background-tasks/control", suite: "background-tasks"},
		{method: "POST", path: "/api/v1/photo-intelligence/reanalyze", suite: "photo-intelligence"},
		{method: "POST", path: "/api/v1/file-recent/:id", suite: "recent"},
		{method: "DELETE", path: "/api/v1/file-recent", suite: "recent"},
		{method: "POST", path: "/api/v1/nodes/:id/directories", suite: "nodes"},
		{method: "POST", path: "/api/v1/nodes/:id/files", suite: "multipart-upload"},
		{method: "POST", path: "/api/v1/nodes/:id/copy", suite: "nodes"},
		{method: "POST", path: "/api/v1/nodes/batch/copy", suite: "nodes"},
		{method: "POST", path: "/api/v1/nodes/batch/move", suite: "nodes"},
		{method: "POST", path: "/api/v1/nodes/batch/delete", suite: "nodes"},
		{method: "POST", path: "/api/v1/nodes/properties/stats", suite: "nodes"},
		{method: "POST", path: "/api/v1/file-operations", suite: "file-operations"},
		{method: "GET", path: "/api/v1/file-operations", suite: "file-operations"},
		{method: "DELETE", path: "/api/v1/file-operations", suite: "file-operations"},
		{method: "GET", path: "/api/v1/file-operations/:id", suite: "file-operations"},
		{method: "POST", path: "/api/v1/file-operations/:id/cancel", suite: "file-operations"},
		{method: "POST", path: "/api/v1/file-operations/:id/retry", suite: "file-operations"},
		{method: "POST", path: "/api/v1/file-operations/:id/undo", suite: "file-operations"},
		{method: "POST", path: "/api/v1/file-operations/:id/redo", suite: "file-operations"},
		{method: "POST", path: "/api/v1/file-operations/:id/resolve", suite: "file-operations"},
		{method: "PATCH", path: "/api/v1/nodes/:id", suite: "nodes"},
		{method: "DELETE", path: "/api/v1/nodes/:id", suite: "trash"},
		{method: "GET", path: "/api/v1/trash", suite: "trash"},
		{method: "POST", path: "/api/v1/trash/:id/restore", suite: "trash"},
		{method: "DELETE", path: "/api/v1/trash/:id", suite: "trash"},
		{method: "GET", path: "/api/v1/files/:id/content", suite: "files"},
		{method: "GET", path: "/api/v1/files/:id/preview/text", suite: "files"},
		{method: "POST", path: "/api/v1/files/:id/preview-ticket", suite: "files"},
		{method: "GET", path: "/api/v1/file-preview/:id", suite: "files"},
		{method: "HEAD", path: "/api/v1/file-preview/:id", suite: "files"},
		{method: "GET", path: "/api/v1/media-analysis-preview/:id", suite: "media"},
		{method: "POST", path: "/api/v1/download/archive/prepare", suite: "files"},
		{method: "GET", path: "/api/v1/download/archive/progress/:id", suite: "files"},
		{method: "POST", path: "/api/v1/download/archive", suite: "files"},
		{method: "GET", path: "/api/v1/media/items", suite: "media"},
		{method: "GET", path: "/api/v1/media/items/:id", suite: "media"},
		{method: "PATCH", path: "/api/v1/media/items/:id/favorite", suite: "media"},
		{method: "PATCH", path: "/api/v1/media/items/:id/tags", suite: "media"},
		{method: "PATCH", path: "/api/v1/media/items/:id/people", suite: "media"},
		{method: "PATCH", path: "/api/v1/media/items/:id/description", suite: "media"},
		{method: "GET", path: "/api/v1/media/items/:id/thumbnail", suite: "media"},
		{method: "GET", path: "/api/v1/media/items/:id/analysis-preview", suite: "media"},
		{method: "GET", path: "/api/v1/media/items/:id/live-photo-motion", suite: "media"},
		{method: "GET", path: "/api/v1/media/items/:id/resources/:role", suite: "media"},
		{method: "GET", path: "/api/v1/media/albums", suite: "media"},
		{method: "GET", path: "/api/v1/media/places", suite: "media"},
		{method: "GET", path: "/api/v1/media/people/suggestions", suite: "media"},
		{method: "GET", path: "/api/v1/media/people/suggestions/:clusterID/items", suite: "media"},
		{method: "POST", path: "/api/v1/media/people/suggestions/:clusterID/adopt", suite: "media"},
		{method: "GET", path: "/api/v1/media/people/identities", suite: "media"},
		{method: "GET", path: "/api/v1/media/people/identities/:personID/items", suite: "media"},
		{method: "PATCH", path: "/api/v1/media/people/identities/:personID", suite: "media"},
		{method: "POST", path: "/api/v1/media/people/identities/:personID/merge", suite: "media"},
		{method: "POST", path: "/api/v1/media/people/identities/:personID/split", suite: "media"},
		{method: "POST", path: "/api/v1/media/albums", suite: "media"},
		{method: "PATCH", path: "/api/v1/media/albums/:albumID", suite: "media"},
		{method: "DELETE", path: "/api/v1/media/albums/:albumID", suite: "media"},
		{method: "GET", path: "/api/v1/media/albums/:albumID/items", suite: "media"},
		{method: "POST", path: "/api/v1/media/albums/:albumID/items", suite: "media"},
		{method: "DELETE", path: "/api/v1/media/albums/:albumID/items/:nodeID", suite: "media"},
		{method: "POST", path: "/api/v1/media/smart-albums", suite: "media"},
		{method: "PATCH", path: "/api/v1/media/smart-albums/:albumID", suite: "media"},
		{method: "DELETE", path: "/api/v1/media/smart-albums/:albumID", suite: "media"},
		{method: "PUT", path: "/api/v1/files/:id/content", suite: "files"},
		{method: "POST", path: "/api/v1/uploads/preflight", suite: "chunk-upload"},
		{method: "POST", path: "/api/v1/uploads", suite: "chunk-upload"},
		{method: "GET", path: "/api/v1/uploads/:id", suite: "chunk-upload"},
		{method: "PUT", path: "/api/v1/uploads/:id/chunks/:index", suite: "chunk-upload"},
		{method: "POST", path: "/api/v1/uploads/:id/finalize", suite: "chunk-upload"},
		{method: "DELETE", path: "/api/v1/uploads/:id", suite: "chunk-upload"},
		{method: "GET", path: "/api/v1/files/:id/versions", suite: "versions"},
		{method: "GET", path: "/api/v1/files/:id/versions/:versionID/content", suite: "versions"},
		{method: "POST", path: "/api/v1/files/:id/versions/:versionID/restore", suite: "versions"},
		{method: "POST", path: "/api/v1/files/:id/shares", suite: "shares"},
		{method: "GET", path: "/api/v1/files/:id/shares", suite: "shares"},
		{method: "DELETE", path: "/api/v1/shares/:id", suite: "shares"},
		{method: "POST", path: "/api/v1/source-credentials/test", suite: "sources"},
		{method: "GET", path: "/api/v1/sources", suite: "sources"},
		{method: "GET", path: "/api/v1/sources/overview", suite: "sources"},
		{method: "POST", path: "/api/v1/sources", suite: "sources"},
		{method: "GET", path: "/api/v1/sources/:id", suite: "sources"},
		{method: "PATCH", path: "/api/v1/sources/:id", suite: "sources"},
		{method: "DELETE", path: "/api/v1/sources/:id", suite: "sources"},
		{method: "POST", path: "/api/v1/sources/:id/trigger", suite: "sources"},
		{method: "GET", path: "/api/v1/sources/:id/credential", suite: "sources"},
		{method: "PUT", path: "/api/v1/sources/:id/credential", suite: "sources"},
		{method: "POST", path: "/api/v1/sources/:id/credential/test", suite: "sources"},
		{method: "POST", path: "/api/v1/sources/:id/credential/reveal", suite: "sources"},
		{method: "DELETE", path: "/api/v1/sources/:id/credential", suite: "sources"},
		{method: "GET", path: "/api/v1/sources/:id/connector-config", suite: "sources"},
		{method: "PUT", path: "/api/v1/sources/:id/connector-config", suite: "sources"},
		{method: "GET", path: "/api/v1/sources/:id/browse", suite: "sources"},
		{method: "GET", path: "/api/v1/sources/:id/items", suite: "sources"},
		{method: "GET", path: "/api/v1/sources/:id/collections", suite: "sources"},
		{method: "GET", path: "/api/v1/sources/:id/collections/:collectionID/items", suite: "sources"},
		{method: "GET", path: "/api/v1/sources/:id/runs", suite: "sources"},
		{method: "POST", path: "/api/v1/sources/:id/runs", suite: "sources"},
		{method: "GET", path: "/api/v1/sources/:id/runs/:runID", suite: "sources"},
		{method: "GET", path: "/api/v1/sources/:id/runs/:runID/failures", suite: "sources"},
		{method: "POST", path: "/api/v1/sources/:id/runs/:runID/observe", suite: "sources"},
		{method: "POST", path: "/api/v1/sources/:id/runs/:runID/commit", suite: "sources"},
		{method: "POST", path: "/api/v1/sources/:id/runs/:runID/failures", suite: "sources"},
		{method: "POST", path: "/api/v1/sources/:id/runs/:runID/progress", suite: "sources"},
		{method: "POST", path: "/api/v1/sources/:id/runs/:runID/cancel", suite: "sources"},
		{method: "POST", path: "/api/v1/sources/:id/runs/:runID/heartbeat", suite: "sources"},
		{method: "POST", path: "/api/v1/sources/:id/runs/:runID/finish", suite: "sources"},
		{method: "GET", path: "/api/v1/admin/users", suite: "admin"},
		{method: "GET", path: "/api/v1/admin/update", suite: "admin"},
		{method: "POST", path: "/api/v1/admin/update", suite: "admin"},
		{method: "GET", path: "/api/v1/admin/audit", suite: "audit"},
		{method: "GET", path: "/api/v1/admin/background-tasks", suite: "background-tasks"},
		{method: "POST", path: "/api/v1/admin/background-tasks/control", suite: "background-tasks"},
		{method: "GET", path: "/api/v1/admin/storage", suite: "storage-intelligence"},
		{method: "GET", path: "/api/v1/admin/storage/health", suite: "storage-intelligence"},
		{method: "GET", path: "/api/v1/admin/storage/history", suite: "storage-intelligence"},
		{method: "GET", path: "/api/v1/admin/storage/staging", suite: "storage-intelligence"},
		{method: "POST", path: "/api/v1/admin/storage/staging/cleanup", suite: "storage-intelligence"},
		{method: "GET", path: "/api/v1/admin/storage/staging/cleanup-runs", suite: "storage-intelligence"},
		{method: "GET", path: "/api/v1/admin/storage/staging/cleanup-runs/:runID/failures", suite: "storage-intelligence"},
		{method: "POST", path: "/api/v1/admin/users", suite: "admin"},
		{method: "PATCH", path: "/api/v1/admin/users/:id", suite: "admin"},
		{method: "DELETE", path: "/api/v1/admin/users/:id", suite: "admin"},
		{method: "POST", path: "/api/v1/admin/users/:id/reset-password", suite: "admin"},
		{method: "POST", path: "/api/v1/admin/users/:id/revoke-sessions", suite: "admin"},
		{method: "POST", path: "/api/v1/admin/users/:id/photo-intelligence/reanalyze", suite: "photo-intelligence"},
	}

	manifest := make(map[string]string, len(coverage))
	for _, entry := range coverage {
		key := entry.method + " " + entry.path
		if _, exists := manifest[key]; exists {
			t.Fatalf("duplicate API coverage entry: %s", key)
		}
		if strings.TrimSpace(entry.suite) == "" {
			t.Fatalf("coverage manifest has no suite for %s", key)
		}
		manifest[key] = entry.suite
	}

	router := (&Server{}).Router()
	registered := make(map[string]struct{}, len(router.Routes()))
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		registered[key] = struct{}{}
	}

	var missing, unexpected []string
	for route := range manifest {
		if _, ok := registered[route]; !ok {
			missing = append(missing, route)
		}
	}
	for route := range registered {
		if _, ok := manifest[route]; !ok {
			unexpected = append(unexpected, route)
		}
	}
	sort.Strings(missing)
	sort.Strings(unexpected)
	if len(missing) != 0 || len(unexpected) != 0 {
		t.Fatalf("API coverage manifest drift: missing registered routes=%v unexpected registered routes=%v", missing, unexpected)
	}
}

func TestEveryProtectedAPIEndpointRequiresBearerToken(t *testing.T) {
	gin.SetMode(gin.TestMode)

	public := map[string]struct{}{
		"GET /metrics":                           {},
		"GET /api/v1/healthz":                    {},
		"GET /api/v1/readyz":                     {},
		"GET /api/v1/version":                    {},
		"POST /api/v1/auth/login":                {},
		"POST /api/v1/auth/refresh":              {},
		"POST /api/v1/auth/logout":               {},
		"GET /api/v1/public/share":               {},
		"POST /api/v1/public/share/download":     {},
		"GET /api/v1/file-preview/:id":           {},
		"HEAD /api/v1/file-preview/:id":          {},
		"GET /api/v1/media-analysis-preview/:id": {},
	}
	replacer := strings.NewReplacer(":versionID", "1", ":collectionID", "1", ":albumID", "folder:1", ":runID", "run-1", ":index", "0", ":id", "1")
	router := (&Server{}).Router()

	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, ok := public[key]; ok {
			continue
		}
		route := route
		t.Run(key, func(t *testing.T) {
			req := httptest.NewRequest(route.Method, replacer.Replace(route.Path), nil)
			res := httptest.NewRecorder()
			router.ServeHTTP(res, req)
			if res.Code != http.StatusUnauthorized {
				t.Fatalf("code=%d want=%d body=%s", res.Code, http.StatusUnauthorized, res.Body.String())
			}
		})
	}
}
