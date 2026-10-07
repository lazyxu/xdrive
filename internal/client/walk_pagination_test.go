package client

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"
)

func TestWalkUsesPagedChildren(t *testing.T) {
	const (
		rootID       = uint64(1)
		nestedDirID  = uint64(2)
		siblingCount = 1201
	)

	var mu sync.Mutex
	rootPageSizes := make([]int, 0, 3)
	rootCursors := make([]string, 0, 3)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/nodes/root":
			_ = json.NewEncoder(w).Encode(Node{
				ID: rootID, Name: "", Type: "dir", Revision: 1,
			})
			return
		case fmt.Sprintf("/api/v1/nodes/%d/children", rootID):
			query := r.URL.Query()
			if query.Get("limit") != "500" || query.Get("sort") != "name" || query.Get("order") != "asc" {
				t.Fatalf("root children query=%q", r.URL.RawQuery)
			}
			cursor := query.Get("cursor")
			start := 0
			switch cursor {
			case "":
				start = 0
			case "root-500":
				start = 500
			case "root-1000":
				start = 1000
			default:
				t.Fatalf("unexpected root cursor %q", cursor)
			}
			end := start + 500
			if end > siblingCount {
				end = siblingCount
			}
			items := make([]Node, 0, end-start)
			for index := start; index < end; index++ {
				id := uint64(index + 2)
				nodeType := "file"
				name := fmt.Sprintf("item-%04d.bin", index)
				if index == 0 {
					id = nestedDirID
					nodeType = "dir"
					name = "dir-0000"
				}
				items = append(items, Node{
					ID: id, ParentID: ptrUint64(rootID), Name: name,
					Type: nodeType, Size: int64(index + 1), Revision: 1,
					CreatedAt: time.Unix(1, 0).UTC(), UpdatedAt: time.Unix(1, 0).UTC(),
				})
			}
			nextCursor := ""
			hasMore := end < siblingCount
			if hasMore {
				nextCursor = "root-" + strconv.Itoa(end)
			}
			mu.Lock()
			rootPageSizes = append(rootPageSizes, len(items))
			rootCursors = append(rootCursors, cursor)
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(ChildrenPage{
				Items: items, NextCursor: nextCursor, HasMore: hasMore,
				Sort: "name", Order: "asc",
			})
			return
		case fmt.Sprintf("/api/v1/nodes/%d/children", nestedDirID):
			query := r.URL.Query()
			if query.Get("limit") != "500" || query.Get("sort") != "name" || query.Get("order") != "asc" {
				t.Fatalf("nested children query=%q", r.URL.RawQuery)
			}
			if query.Get("cursor") != "" {
				t.Fatalf("nested directory must fit one page, cursor=%q", query.Get("cursor"))
			}
			_ = json.NewEncoder(w).Encode(ChildrenPage{
				Items: []Node{{
					ID: 5000, ParentID: ptrUint64(nestedDirID),
					Name: "nested.txt", Type: "file", Size: 7, Revision: 1,
					CreatedAt: time.Unix(1, 0).UTC(), UpdatedAt: time.Unix(1, 0).UTC(),
				}},
				HasMore: false, Sort: "name", Order: "asc",
			})
			return
		default:
			t.Fatalf("unexpected request path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	cli := New(server.URL, "")
	cli.HTTP = server.Client()
	nodes, err := cli.Walk(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	if len(nodes) != 1+siblingCount+1 {
		t.Fatalf("walk node count=%d want=%d", len(nodes), 1+siblingCount+1)
	}
	if node, ok := nodes["dir-0000/nested.txt"]; !ok || node.ID != 5000 {
		t.Fatalf("nested path missing or wrong: %+v ok=%v", node, ok)
	}

	mu.Lock()
	defer mu.Unlock()
	wantSizes := []int{500, 500, 201}
	if len(rootPageSizes) != len(wantSizes) {
		t.Fatalf("root page count=%d sizes=%v", len(rootPageSizes), rootPageSizes)
	}
	for index, want := range wantSizes {
		if rootPageSizes[index] != want {
			t.Fatalf("root page %d size=%d want=%d; all=%v", index, rootPageSizes[index], want, rootPageSizes)
		}
	}
	wantCursors := []string{"", "root-500", "root-1000"}
	for index, want := range wantCursors {
		if rootCursors[index] != want {
			t.Fatalf("root cursor %d=%q want=%q; all=%v", index, rootCursors[index], want, rootCursors)
		}
	}
}

func TestWalkRejectsNonAdvancingChildrenCursor(t *testing.T) {
	const rootID = uint64(1)
	requests := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/nodes/root":
			_ = json.NewEncoder(w).Encode(Node{ID: rootID, Type: "dir", Revision: 1})
		case fmt.Sprintf("/api/v1/nodes/%d/children", rootID):
			requests++
			cursor := r.URL.Query().Get("cursor")
			next := "stuck"
			if cursor == "" {
				next = "stuck"
			}
			_ = json.NewEncoder(w).Encode(ChildrenPage{
				Items:      []Node{},
				NextCursor: next,
				HasMore:    true,
				Sort:       "name",
				Order:      "asc",
			})
		default:
			t.Fatalf("unexpected request path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	cli := New(server.URL, "")
	cli.HTTP = server.Client()
	_, err := cli.Walk(context.Background())
	if err == nil {
		t.Fatal("Walk must reject a has_more page whose cursor does not advance")
	}
	if got := err.Error(); got != "children pagination did not advance for node 1" {
		t.Fatalf("Walk error=%q", got)
	}
	if requests != 2 {
		t.Fatalf("children requests=%d want=2", requests)
	}
}

func ptrUint64(value uint64) *uint64 {
	return &value
}
