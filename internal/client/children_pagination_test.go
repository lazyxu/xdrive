package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListPageEncodesChildrenOptions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/nodes/42/children" {
			t.Fatalf("path=%q", r.URL.Path)
		}
		query := r.URL.Query()
		if query.Get("limit") != "25" || query.Get("cursor") != "next" || query.Get("sort") != "size" || query.Get("order") != "desc" || query.Get("name") != "Exact Name" {
			t.Fatalf("unexpected query: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":9,"name":"large.bin","type":"file","size":99,"revision":1,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-01T00:00:00Z"}],"next_cursor":"after","has_more":true,"sort":"size","order":"desc"}`))
	}))
	defer server.Close()

	cli := New(server.URL, "")
	cli.HTTP = server.Client()
	page, err := cli.ListPage(context.Background(), 42, ChildrenOptions{
		Limit: 25, Cursor: "next", Sort: "size", Order: "desc", Name: "Exact Name",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != 9 || page.NextCursor != "after" || !page.HasMore {
		t.Fatalf("unexpected page: %+v", page)
	}
}
