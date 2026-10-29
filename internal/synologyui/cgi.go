package synologyui

import (
	"net/http"
	"net/url"
)

// DSM registers one fixed /webman/3rdparty CGI entry. Some DSM builds do
// not forward an additional PATH_INFO suffix to shell CGIs, so the browser
// uses ?op=... rather than /backup.cgi/v1/.... Only these operations exist.
const DSMCGIPath = "/webman/3rdparty/xdrivenas/backup.cgi"

func CGIHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, private")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r == nil || r.URL == nil || r.URL.Path != DSMCGIPath ||
			r.URL.EscapedPath() != DSMCGIPath || r.TLS == nil {
			http.Error(w, "DSM HTTPS CGI route required", http.StatusForbidden)
			return
		}
		// url.ParseQuery rejects malformed escaping and semicolons; Query()
		// silently discards them and could weaken duplicate-field checks.
		q, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(q["op"]) != 1 {
			http.Error(w, "invalid CGI operation", http.StatusBadRequest)
			return
		}
		op := q.Get("op")
		switch op {
		case "bootstrap", "sources", "status", "history", "run", "control", "schedule",
			"device-backups", "device-backup-runs",
			"device-backup-page", "device-backup-folders", "cloud-quota",
			"cloud-root", "cloud-children", "cloud-text-preview", "cloud-media-range",
			"cloud-media-stream", "cloud-thumbnail", "cloud-gallery-items", "cloud-gallery-albums",
			"cloud-live-motion":
		default:
			http.Error(w, "unknown CGI operation", http.StatusNotFound)
			return
		}
		q.Del("op")
		copyRequest := r.Clone(r.Context())
		copiedURL := *r.URL
		copiedURL.Path = "/v1/" + op
		copiedURL.RawPath = ""
		copiedURL.RawQuery = q.Encode()
		copyRequest.URL = &copiedURL
		next.ServeHTTP(w, copyRequest)
	})
}
