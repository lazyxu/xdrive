//go:build linux

package mount

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"syscall"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestLinuxReaddirUsesPagedChildren(t *testing.T) {
	const (
		parentID   = uint64(77)
		childCount = 1201
	)

	var mu sync.Mutex
	pageSizes := make([]int, 0, 3)
	cursors := make([]string, 0, 3)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/nodes/77/children" {
			http.NotFound(w, r)
			return
		}
		query := r.URL.Query()
		if query.Get("limit") != "500" || query.Get("sort") != "name" || query.Get("order") != "asc" {
			t.Fatalf("readdir query=%q", r.URL.RawQuery)
		}

		cursor := query.Get("cursor")
		start := 0
		switch cursor {
		case "":
			start = 0
		case "cursor-500":
			start = 500
		case "cursor-1000":
			start = 1000
		default:
			t.Fatalf("unexpected cursor %q", cursor)
		}
		end := start + linuxReaddirPageLimit
		if end > childCount {
			end = childCount
		}

		items := make([]client.Node, 0, end-start)
		for index := start; index < end; index++ {
			nodeType := "file"
			if index%100 == 0 {
				nodeType = "dir"
			}
			parent := parentID
			items = append(items, client.Node{
				ID:       uint64(index + 1000),
				ParentID: &parent,
				Name:     fmt.Sprintf("item-%04d", index),
				Type:     nodeType,
				Revision: 1,
			})
		}

		hasMore := end < childCount
		nextCursor := ""
		if hasMore {
			nextCursor = fmt.Sprintf("cursor-%d", end)
		}
		mu.Lock()
		pageSizes = append(pageSizes, len(items))
		cursors = append(cursors, cursor)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(client.ChildrenPage{
			Items:      items,
			NextCursor: nextCursor,
			HasMore:    hasMore,
			Sort:       "name",
			Order:      "asc",
		})
	}))
	defer server.Close()

	cli := client.New(server.URL, "token")
	cli.HTTP = server.Client()
	node := &linuxNode{
		cli:  cli,
		node: client.Node{ID: parentID, Type: "dir", Revision: 1},
	}

	stream, errno := node.Readdir(context.Background())
	if errno != 0 {
		t.Fatalf("Readdir errno=%v", errno)
	}
	defer stream.Close()

	count := 0
	directories := 0
	for stream.HasNext() {
		entry, errno := stream.Next()
		if errno != 0 {
			t.Fatalf("stream next errno=%v", errno)
		}
		count++
		if entry.Mode == syscall.S_IFDIR {
			directories++
		}
	}
	if count != childCount {
		t.Fatalf("readdir entries=%d want=%d", count, childCount)
	}
	if directories != 13 {
		t.Fatalf("directory entries=%d want=13", directories)
	}

	mu.Lock()
	defer mu.Unlock()
	wantSizes := []int{500, 500, 201}
	if len(pageSizes) != len(wantSizes) {
		t.Fatalf("page count=%d sizes=%v", len(pageSizes), pageSizes)
	}
	for index, want := range wantSizes {
		if pageSizes[index] != want {
			t.Fatalf("page %d size=%d want=%d; all=%v", index, pageSizes[index], want, pageSizes)
		}
	}
	wantCursors := []string{"", "cursor-500", "cursor-1000"}
	for index, want := range wantCursors {
		if cursors[index] != want {
			t.Fatalf("cursor %d=%q want=%q; all=%v", index, cursors[index], want, cursors)
		}
	}
}

func TestLinuxReaddirRejectsNonAdvancingCursor(t *testing.T) {
	const parentID = uint64(77)
	requests := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/nodes/77/children" {
			http.NotFound(w, r)
			return
		}
		requests++
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(client.ChildrenPage{
			Items:      []client.Node{},
			NextCursor: "stuck",
			HasMore:    true,
			Sort:       "name",
			Order:      "asc",
		})
	}))
	defer server.Close()

	cli := client.New(server.URL, "token")
	cli.HTTP = server.Client()
	node := &linuxNode{
		cli:  cli,
		node: client.Node{ID: parentID, Type: "dir", Revision: 1},
	}

	stream, errno := node.Readdir(context.Background())
	if stream != nil {
		stream.Close()
		t.Fatal("non-advancing cursor must not return a directory stream")
	}
	if errno != syscall.EIO {
		t.Fatalf("Readdir errno=%v want=%v", errno, syscall.EIO)
	}
	if requests != 2 {
		t.Fatalf("children requests=%d want=2", requests)
	}
}
