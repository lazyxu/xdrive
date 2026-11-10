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
			"device-backup-page", "device-backup-folders", "cloud-quota", "nas-volume",
			"cloud-root", "cloud-children", "cloud-search", "cloud-create-folder", "cloud-rename-node", "cloud-delete-node", "cloud-move-node", "cloud-copy-node", "cloud-upload-file", "cloud-text-preview", "cloud-media-range",
			"cloud-media-stream", "cloud-thumbnail", "cloud-viewer-preview", "cloud-gallery-items", "cloud-gallery-albums",
			"cloud-gallery-places", "cloud-gallery-place-items", "cloud-gallery-map-overview",
			"cloud-live-motion", "nas-shares", "nas-share-preflight",
			"local-source", "local-source-rename", "local-target", "local-mode", "local-rules", "local-bound-remove",
			"cloud-clipboard-capability", "cloud-clipboard-vault", "cloud-clipboard-check",
			"cloud-clipboard-list", "cloud-clipboard-devices", "cloud-clipboard-file", "cloud-clipboard-create",
			"cloud-clipboard-enable-device", "cloud-clipboard-decrypt",
			"cloud-clipboard-revoke-device",
			"cloud-clipboard-delete", "cloud-clipboard-clear",
			"cloud-notes-capability", "cloud-notes-namespace", "cloud-notes-list", "cloud-notes-read",
			"cloud-notes-create", "cloud-notes-import-ios", "cloud-notes-save", "cloud-notes-delete",
			"cloud-notes-versions", "cloud-notes-history",
			"cloud-notes-image-capability", "cloud-notes-image-upload", "cloud-notes-image-import", "cloud-notes-image-read",
			"server-connection", "server-login", "nas-share-create", "nas-draft-bind", "nas-drafts", "recovery-review":
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
