package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNodeChanges(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/changes" {
			http.NotFound(w, r)
			return
		}
		if got := r.URL.Query().Get("after"); got != "41" {
			t.Fatalf("after=%q", got)
		}
		if got := r.URL.Query().Get("limit"); got != "25" {
			t.Fatalf("limit=%q", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer token" {
			t.Fatalf("Authorization=%q", got)
		}
		_ = json.NewEncoder(w).Encode(NodeChangePage{
			Changes: []NodeChange{{
				Cursor: 42, NodeID: 7, Operation: "upsert", AffectedParentIDs: []uint64{2, 9}, Path: "docs/report.txt",
				Node: &Node{ID: 7, ParentID: uint64Ptr(2), Name: "report.txt", Type: "file", Revision: 3, Size: 99},
			}},
			NextCursor: 42, LatestCursor: 42,
		})
	}))
	defer server.Close()

	page, err := New(server.URL, "token").NodeChanges(context.Background(), 41, 25)
	if err != nil {
		t.Fatal(err)
	}
	if page.NextCursor != 42 || page.LatestCursor != 42 || len(page.Changes) != 1 {
		t.Fatalf("page=%+v", page)
	}
	change := page.Changes[0]
	if change.Operation != "upsert" || change.Path != "docs/report.txt" ||
		change.Node == nil || change.Node.Revision != 3 ||
		len(change.AffectedParentIDs) != 2 || change.AffectedParentIDs[0] != 2 || change.AffectedParentIDs[1] != 9 {
		t.Fatalf("change=%+v", change)
	}
}
