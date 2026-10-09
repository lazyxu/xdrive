package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDesktopIPCSelectionValidatesBeforeControllerAccess(t *testing.T) {
	validToken := "123e4567-e89b-12d3-a456-426614174000"
	cases := []struct {
		name   string
		method string
		path   string
		body   string
		want   int
	}{
		{"invalid token", http.MethodGet, "/v1/media/selection-snapshot?token=bad", "", http.StatusBadRequest},
		{"page over cap", http.MethodGet, "/v1/media/selection-snapshot?token=" + validToken + "&limit=201", "", http.StatusBadRequest},
		{"negative offset", http.MethodGet, "/v1/media/selection-snapshot?token=" + validToken + "&offset=-1", "", http.StatusBadRequest},
		{"missing exclusion", http.MethodPatch, "/v1/media/selection-snapshot/exclusion?token=" + validToken, `{"node_id":23,"version":1}`, http.StatusBadRequest},
		{"zero revision", http.MethodPatch, "/v1/media/selection-snapshot/exclusion?token=" + validToken, `{"node_id":23,"version":0,"excluded":false}`, http.StatusBadRequest},
		{"bad day", http.MethodPost, "/v1/media/selection-snapshot?day=2026-02-30", "", http.StatusBadRequest},
		{"folded selection", http.MethodPost, "/v1/media/selection-snapshot?fold_duplicates=true", "", http.StatusBadRequest},
		{"invalid delete token", http.MethodDelete, "/v1/media/selection-snapshot?token=bad", "", http.StatusBadRequest},
		{"legacy read", http.MethodGet, "/v1/media/selection-snapshot?token=" + validToken, "", http.StatusNotImplemented},
		{"legacy create", http.MethodPost, "/v1/media/selection-snapshot", "", http.StatusNotImplemented},
		{"legacy delete", http.MethodDelete, "/v1/media/selection-snapshot?token=" + validToken, "", http.StatusNotImplemented},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			rec := httptest.NewRecorder()
			handler := &desktopIPCHandler{}
			switch tc.method {
			case http.MethodGet:
				handler.mediaGetSelectionSnapshot(rec, req)
			case http.MethodPatch:
				handler.mediaSetSelectionExcluded(rec, req)
			case http.MethodPost:
				handler.mediaCreateSelectionSnapshot(rec, req)
			case http.MethodDelete:
				handler.mediaDeleteSelectionSnapshot(rec, req)
			}
			if rec.Code != tc.want {
				t.Fatalf("status=%d want=%d body=%s", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}
