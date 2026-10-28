package localbackupipc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOwnerGalleryReadRequiresIndependentAgentCapability(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodGet ||
			r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			t.Error("wrong Agent auth or method")
			http.Error(w, "unauthorized", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/cloud/owner-gallery-items":
			q := r.URL.Query()
			if q.Get("kind") != "all" || q.Get("limit") != "100" ||
				q.Get("offset") != "0" || len(q) != 3 {
				t.Errorf("unexpected Owner Gallery selector: %v", q)
			}
			_, _ = w.Write([]byte(`{"items":[{"node":{"id":42,"parent_id":17,"name":"photo.jpg","type":"file","size":12,"revision":7,"created_at":"2026-10-28T00:00:00Z","updated_at":"2026-10-28T00:00:00Z"},"metadata":{"media_kind":"image","index_state":"ready","has_thumbnail":true}}],"total_count":1,"offset":0,"limit":100}`))
		case "/v1/cloud/owner-gallery-albums":
			if r.URL.RawQuery != "" {
				t.Error("Owner album inventory received a query")
			}
			_, _ = w.Write([]byte(`[{"id":"manual:abc","kind":"manual","name":"Owner album","item_count":1}]`))
		default:
			t.Errorf("unexpected Agent method %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	agent := &Client{baseURL: server.URL, token: strings.Repeat("a", 64), http: server.Client()}
	if _, err := agent.OwnerGalleryItemsRange(context.Background(), "all", 100, 0, ""); err == nil {
		t.Fatal("unadvertised Owner Gallery capability was accessible")
	}
	if _, err := agent.OwnerGalleryAlbums(context.Background()); err == nil {
		t.Fatal("unadvertised Owner albums capability was accessible")
	}
	if calls != 0 { t.Fatal("unauthorized client called the Agent") }
	agent.capabilities = []string{"cloud-owner-gallery-read"}
	page, err := agent.OwnerGalleryItemsRange(context.Background(), "all", 100, 0, "")
	if err != nil || len(page.Items) != 1 || page.Items[0].Node.ParentID != 17 {
		t.Fatalf("genuine Owner Gallery read failed: %+v, %v", page, err)
	}
	albums, err := agent.OwnerGalleryAlbums(context.Background())
	if err != nil || len(albums) != 1 || albums[0].ID != "manual:abc" {
		t.Fatalf("genuine Owner albums read failed: %+v, %v", albums, err)
	}
	if calls != 2 { t.Fatalf("unexpected Agent calls: %d", calls) }
	for _, bad := range []struct { kind string; limit, offset int; album string }{
		{"all", 0, 0, ""}, {"all", 101, 0, ""}, {"other", 100, 0, ""},
		{"all", 100, -1, ""}, {"all", 100, 0, "../private"},
		{"all", 100, 0, "manual:evil?op=run"},
	} {
		if _, err := agent.OwnerGalleryItemsRange(
			context.Background(), bad.kind, bad.limit, bad.offset, bad.album); err == nil {
			t.Errorf("invalid Owner Gallery selector admitted: %+v", bad)
		}
	}
	if calls != 2 { t.Fatal("invalid range selector contacted authenticated Agent") }
}
