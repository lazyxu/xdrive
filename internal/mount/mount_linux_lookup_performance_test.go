//go:build linux

package mount

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestLinuxFindChildUsesExactServerLookup(t *testing.T) {
	const parentID = uint64(77)
	var requests atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/nodes/77/children" {
			http.NotFound(w, r)
			return
		}
		requests.Add(1)
		query := r.URL.Query()
		if query.Get("limit") != "1" {
			t.Fatalf("lookup limit=%q want=1", query.Get("limit"))
		}
		if query.Get("cursor") != "" {
			t.Fatalf("lookup cursor=%q want empty", query.Get("cursor"))
		}
		name := query.Get("name")
		if name == "" {
			t.Fatal("Linux point lookup must use the exact name filter instead of listing all siblings")
		}

		items := []client.Node{}
		if name == "target.txt" {
			parent := parentID
			items = append(items, client.Node{
				ID:       88,
				ParentID: &parent,
				Name:     "target.txt",
				Type:     "file",
				Revision: 4,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(client.ChildrenPage{
			Items:   items,
			HasMore: false,
			Sort:    "name",
			Order:   "asc",
		})
	}))
	defer server.Close()

	cli := client.New(server.URL, "token")
	cli.HTTP = server.Client()
	node := &linuxNode{
		cli:  cli,
		node: client.Node{ID: parentID, Type: "dir", Revision: 1},
	}

	child, err := node.findChild(context.Background(), "target.txt")
	if err != nil {
		t.Fatal(err)
	}
	if child.ID != 88 || child.Name != "target.txt" {
		t.Fatalf("exact child=%+v", child)
	}

	_, err = node.findChild(context.Background(), "missing.txt")
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing child err=%v want os.ErrNotExist", err)
	}
	if got := requests.Load(); got != 2 {
		t.Fatalf("exact child requests=%d want=2", got)
	}
}
