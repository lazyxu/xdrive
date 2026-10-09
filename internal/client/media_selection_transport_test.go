package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestMediaSelectionSnapshotClientTransport(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer token" {
			t.Errorf("authorization=%q", got)
		}
		paths = append(paths, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "POST /api/v1/media/selection-snapshots":
			q := r.URL.Query()
			for key, want := range map[string]string{
				"album_id": "manual:6", "day": "2026-03-08", "sort_by": "captured", "time_zone": "America/New_York", "folder_id": "42", "include_descendants": "true", "q": "family",
			} {
				if got := q.Get(key); got != want {
					t.Errorf("%s=%q want %q", key, got, want)
				}
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"token":"123e4567-e89b-12d3-a456-426614174000","version":1,"total":230,"selected":230,"excluded":0,"day":"2026-03-08","expires_at":"2026-10-09T14:00:00Z"}`))
		case "GET /api/v1/media/selection-snapshots/123e4567-e89b-12d3-a456-426614174000":
			if q := r.URL.Query(); q.Get("offset") != "100" || q.Get("limit") != "50" {
				t.Errorf("page query=%s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"token":"123e4567-e89b-12d3-a456-426614174000","version":1,"total":230,"selected":230,"excluded":0,"day":"2026-03-08","offset":100,"limit":50,"items":[{"node_id":23,"revision":7,"name":"photo.jpg","stale":false}],"has_more":true,"expires_at":"2026-10-09T14:00:00Z"}`))
		case "PATCH /api/v1/media/selection-snapshots/123e4567-e89b-12d3-a456-426614174000/exclusion":
			var input struct {
				NodeID   uint64 `json:"node_id"`
				Excluded *bool  `json:"excluded"`
				Version  uint64 `json:"version"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Error(err)
			}
			if input.NodeID != 23 || input.Excluded == nil || *input.Excluded || input.Version != 1 {
				t.Errorf("exclusion=%+v", input)
			}
			_, _ = w.Write([]byte(`{"token":"123e4567-e89b-12d3-a456-426614174000","version":2,"total":230,"selected":230,"excluded":0,"expires_at":"2026-10-09T14:00:00Z"}`))
		case "DELETE /api/v1/media/selection-snapshots/123e4567-e89b-12d3-a456-426614174000":
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected HTTP %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := New(srv.URL, "token")
	ctx := context.Background()
	query := MediaQuery{Search: "family", SortBy: "captured", TimeZone: "America/New_York", FolderID: 42, IncludeDescendants: true}
	selection, err := c.MediaCreateSelectionSnapshot(ctx, query, "manual:6", "2026-03-08")
	if err != nil || selection.Total != 230 || selection.Version != 1 {
		t.Fatalf("snapshot=%+v err=%v", selection, err)
	}
	page, err := c.MediaGetSelectionSnapshot(ctx, selection.Token, 100, 50)
	if err != nil || len(page.Items) != 1 || page.Items[0].NodeID != 23 || !page.HasMore {
		t.Fatalf("page=%+v err=%v", page, err)
	}
	restored, err := c.MediaSetSelectionExcluded(ctx, selection.Token, 23, false, 1)
	if err != nil || restored.Version != 2 {
		t.Fatalf("exclusion=%+v err=%v", restored, err)
	}
	if err := c.MediaDeleteSelectionSnapshot(ctx, selection.Token); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(paths, []string{
		"POST /api/v1/media/selection-snapshots", "GET /api/v1/media/selection-snapshots/123e4567-e89b-12d3-a456-426614174000",
		"PATCH /api/v1/media/selection-snapshots/123e4567-e89b-12d3-a456-426614174000/exclusion", "DELETE /api/v1/media/selection-snapshots/123e4567-e89b-12d3-a456-426614174000",
	}) {
		t.Errorf("paths=%v", paths)
	}
	if _, err := c.MediaGetSelectionSnapshot(ctx, selection.Token, 100, 201); err == nil {
		t.Fatal("invalid page limit accepted")
	}
	if _, err := c.MediaSetSelectionExcluded(ctx, selection.Token, 23, false, 0); err == nil {
		t.Fatal("zero version accepted")
	}
}
