//go:build windows

package mount

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestWindowsConflictSourceRefreshUsesExactNodeLookup(t *testing.T) {
	const nodeID = uint64(42)

	var exactRequests atomic.Int32
	var rootRequests atomic.Int32
	var childRequests atomic.Int32
	parentID := uint64(1)

	current := client.Node{
		ID:        nodeID,
		ParentID:  &parentID,
		Name:      "remote.txt",
		Type:      "file",
		Size:      9,
		Revision:  7,
		SHA256:    "updated",
		CreatedAt: time.Unix(100, 0),
		UpdatedAt: time.Unix(200, 0),
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/nodes/42":
			exactRequests.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(current)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/nodes/root":
			rootRequests.Add(1)
			http.Error(w, "full-tree root lookup is forbidden for conflict refresh", http.StatusInternalServerError)
		case r.Method == http.MethodGet &&
			len(r.URL.Path) >= len("/children") &&
			r.URL.Path[len(r.URL.Path)-len("/children"):] == "/children":
			childRequests.Add(1)
			http.Error(w, "full-tree children lookup is forbidden for conflict refresh", http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	cli := client.New(server.URL, "token")
	cli.HTTP = server.Client()
	provider := &winProvider{cli: cli}

	got, err := provider.refreshConflictSourceNode(context.Background(), nodeID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != nodeID || got.Revision != current.Revision || got.Name != current.Name {
		t.Fatalf("exact node=%+v want=%+v", got, current)
	}
	if got := exactRequests.Load(); got != 1 {
		t.Fatalf("exact node requests=%d want=1", got)
	}
	if got := rootRequests.Load(); got != 0 {
		t.Fatalf("root requests=%d want=0", got)
	}
	if got := childRequests.Load(); got != 0 {
		t.Fatalf("children requests=%d want=0", got)
	}
}
