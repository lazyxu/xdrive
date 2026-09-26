package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSearchUsesServerPaginationAndFilters(t *testing.T) {
	var seenAuthorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/search" {
			t.Fatalf("path=%q", r.URL.Path)
		}
		if got := r.URL.Query().Get("q"); got != "report 2026" {
			t.Fatalf("q=%q", got)
		}
		if got := r.URL.Query().Get("type"); got != "file" {
			t.Fatalf("type=%q", got)
		}
		if got := r.URL.Query().Get("limit"); got != "25" {
			t.Fatalf("limit=%q", got)
		}
		if got := r.URL.Query().Get("cursor"); got != "next-token" {
			t.Fatalf("cursor=%q", got)
		}
		seenAuthorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(SearchPage{
			Items: []SearchResult{{
				Node: Node{
					ID: 3, ParentID: ptrClientUint64(2), Name: "report 2026.pdf",
					Type: "file", Size: 12, Revision: 2,
					CreatedAt: time.Unix(0, 0).UTC(), UpdatedAt: time.Unix(0, 0).UTC(),
				},
				Path:        "Projects/report 2026.pdf",
				Breadcrumbs: []SearchBreadcrumb{{ID: 1, Name: ""}, {ID: 2, Name: "Projects"}},
			}},
			NextCursor: "next-page",
		})
	}))
	defer server.Close()

	cli := New(server.URL, "token")
	page, err := cli.Search(context.Background(), SearchOptions{
		Query: "report 2026", Type: "file", Limit: 25, Cursor: "next-token",
	})
	if err != nil {
		t.Fatal(err)
	}
	if seenAuthorization != "Bearer token" {
		t.Fatalf("authorization=%q", seenAuthorization)
	}
	if len(page.Items) != 1 || page.Items[0].Path != "Projects/report 2026.pdf" {
		t.Fatalf("unexpected search page: %+v", page)
	}
	if page.NextCursor != "next-page" {
		t.Fatalf("next cursor=%q", page.NextCursor)
	}
	if len(page.Items[0].Breadcrumbs) != 2 || page.Items[0].Breadcrumbs[1].Name != "Projects" {
		t.Fatalf("breadcrumbs=%+v", page.Items[0].Breadcrumbs)
	}
}

func ptrClientUint64(value uint64) *uint64 { return &value }
