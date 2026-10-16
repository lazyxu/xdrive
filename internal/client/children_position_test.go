package client

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestLocateChildPositionTransportAndBounds(t *testing.T) {
	var calls atomic.Int64
	var mode atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/nodes/12/children/position" ||
			r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("unexpected authenticated request: %s %s", r.Method, r.URL.Path)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		q := r.URL.Query()
		if len(q) != 5 || q.Get("node_id") != "99" || q.Get("sort") != "updated" ||
			q.Get("order") != "desc" || q.Get("group") != "modified" ||
			q.Get("folders_first") != "false" {
			t.Errorf("sort/group parameters differ from authoritative Range: %v", q)
			http.Error(w, "bad query", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch mode.Load() {
		case 1:
			_, _ = fmt.Fprint(w, `{"node_id":99,"revision":8,"index":54321,"sort":"name","order":"desc","group":"modified","folders_first":false}`)
		case 2:
			w.WriteHeader(http.StatusNotFound)
			_, _ = fmt.Fprint(w, `{"error":"node not found in directory"}`)
		case 3:
			_, _ = fmt.Fprint(w, `{"node_id":99,"revision":0,"index":54321,"sort":"updated","order":"desc","group":"modified","folders_first":false}`)
		default:
			_, _ = fmt.Fprint(w, `{"node_id":99,"revision":8,"index":54321,"sort":"updated","order":"desc","group":"modified","folders_first":false}`)
		}
	}))
	defer server.Close()
	client := New(server.URL, "test-token")
	falseValue := false
	options := ChildrenPositionOptions{
		Sort: "updated_at", Order: "DESC",
		Grouping: FileExplorerGroupingOptions{Group: "modified", FoldersFirst: &falseValue},
	}
	result, err := client.LocateChildPosition(context.Background(), 12, 99, options)
	if err != nil || result.NodeID != 99 || result.Revision != 8 || result.Index != 54321 ||
		result.Sort != "updated" || result.Order != "desc" || result.Group != "modified" || result.FoldersFirst {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected one HTTP request, got %d", calls.Load())
	}
	for _, invalid := range []struct {
		parent, node uint64
		options      ChildrenPositionOptions
	}{
		{0, 99, options}, {12, 0, options}, {12, ^uint64(0), options},
		{^uint64(0), 99, options},
		{12, 99, ChildrenPositionOptions{Sort: "invalid"}},
		{12, 99, ChildrenPositionOptions{Order: "sideways"}},
		{12, 99, ChildrenPositionOptions{Grouping: FileExplorerGroupingOptions{Group: "bad"}}},
	} {
		if _, err := client.LocateChildPosition(context.Background(), invalid.parent, invalid.node, invalid.options); err == nil {
			t.Fatalf("invalid input accepted: %+v", invalid)
		}
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := client.LocateChildPosition(canceled, 12, 99, options); err == nil {
		t.Fatal("canceled request must not return success")
	}
	if calls.Load() != 1 {
		t.Fatalf("invalid and already canceled inputs should issue no HTTP, got %d", calls.Load())
	}
	for _, scenario := range []int64{1, 2, 3} {
		mode.Store(scenario)
		if _, err := client.LocateChildPosition(context.Background(), 12, 99, options); err == nil {
			t.Fatalf("mismatched or denied scenario %d returned success", scenario)
		}
	}
	if calls.Load() != 4 {
		t.Fatalf("expected four total HTTP requests, got %d", calls.Load())
	}
}
