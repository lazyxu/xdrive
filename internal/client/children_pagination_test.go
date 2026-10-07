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

func TestListRangeEncodesStableChildrenWindow(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/nodes/42/children" {
			t.Fatalf("path=%q", r.URL.Path)
		}
		query := r.URL.Query()
		if query.Get("limit") != "200" || query.Get("offset") != "400" || query.Get("sort") != "updated" || query.Get("order") != "desc" {
			t.Fatalf("unexpected query: %s", r.URL.RawQuery)
		}
		if query.Get("cursor") != "" {
			t.Fatalf("range request must not send cursor: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":9,"name":"late.bin","type":"file","size":99,"revision":1,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-01T00:00:00Z"}],"total_count":1001,"offset":400,"limit":200,"sort":"updated","order":"desc"}`))
	}))
	defer server.Close()

	cli := New(server.URL, "")
	cli.HTTP = server.Client()
	page, err := cli.ListRange(context.Background(), 42, ChildrenRangeOptions{
		Limit: 200, Offset: 400, Sort: "updated", Order: "desc",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != 9 || page.TotalCount != 1001 || page.Offset != 400 || page.Limit != 200 {
		t.Fatalf("unexpected range: %+v", page)
	}
	if !page.HasTotalCount() {
		t.Fatalf("legacy range response with total_count must remain authoritative: %+v", page)
	}
}

func TestListRangeCanOmitTotalCount(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		if query.Get("offset") != "400" || query.Get("include_count") != "false" {
			t.Fatalf("unexpected query: %s", r.URL.RawQuery)
		}
		if query.Get("group") != "size" || query.Get("folders_first") != "false" {
			t.Fatalf("grouping query: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":9,"name":"late.bin","type":"file","size":99,"revision":1,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-01T00:00:00Z"}],"total_count":0,"total_count_included":false,"offset":400,"limit":200,"sort":"updated","order":"desc"}`))
	}))
	defer server.Close()

	cli := New(server.URL, "")
	cli.HTTP = server.Client()
	foldersFirst := false
	page, err := cli.ListRange(context.Background(), 42, ChildrenRangeOptions{
		Limit: 200, Offset: 400, Sort: "updated", Order: "desc", OmitTotalCount: true,
		Grouping: FileExplorerGroupingOptions{Group: "size", FoldersFirst: &foldersFirst},
	})
	if err != nil {
		t.Fatal(err)
	}
	if page.HasTotalCount() || page.TotalCount != 0 || len(page.Items) != 1 || page.Items[0].ID != 9 {
		t.Fatalf("unexpected count-free range: %+v", page)
	}
}

func TestListRangeRejectsNegativeOffset(t *testing.T) {
	cli := New("http://example.invalid", "")
	if _, err := cli.ListRange(context.Background(), 42, ChildrenRangeOptions{Offset: -1}); err == nil {
		t.Fatal("negative range offset must be rejected before transport")
	}
}

func TestListPageEncodesCaseInsensitiveNameLookup(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/nodes/42/children" {
			t.Fatalf("path=%q", r.URL.Path)
		}
		query := r.URL.Query()
		if query.Get("limit") != "1" || query.Get("sort") != "name" || query.Get("order") != "asc" || query.Get("name_ci") != "folder" {
			t.Fatalf("unexpected query: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":9,"name":"Folder","type":"dir","size":0,"revision":1,"created_at":"2026-10-01T00:00:00Z","updated_at":"2026-10-01T00:00:00Z"}],"has_more":false,"sort":"name","order":"asc"}`))
	}))
	defer server.Close()

	cli := New(server.URL, "")
	cli.HTTP = server.Client()
	page, err := cli.ListPage(context.Background(), 42, ChildrenOptions{
		Limit: 1, Sort: "name", Order: "asc", NameCI: "folder",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != 9 {
		t.Fatalf("unexpected page: %+v", page)
	}
}
