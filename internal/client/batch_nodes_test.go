package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBatchNodeMutationsUseAtomicEndpoints(t *testing.T) {
	type requestBody struct {
		Items    []BatchNodeRef `json:"items"`
		ParentID uint64         `json:"parent_id"`
	}
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.Path)
		var body requestBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Items) != 2 || body.Items[0].ID != 1 || body.Items[0].Revision != 2 || body.Items[1].ID != 3 || body.Items[1].Revision != 4 {
			t.Fatalf("unexpected batch items: %+v", body.Items)
		}
		switch r.URL.Path {
		case "/api/v1/nodes/batch/copy", "/api/v1/nodes/batch/move":
			if body.ParentID != 9 {
				t.Fatalf("parent_id=%d want=9", body.ParentID)
			}
		case "/api/v1/nodes/batch/delete":
			if body.ParentID != 0 {
				t.Fatalf("delete should not send parent_id: %d", body.ParentID)
			}
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"operation_id":"op-1","items":[],"deleted_ids":[1,3]}`))
	}))
	defer server.Close()

	cli := New(server.URL, "")
	cli.HTTP = server.Client()
	items := []BatchNodeRef{{ID: 1, Revision: 2}, {ID: 3, Revision: 4}}

	if _, err := cli.BatchCopy(context.Background(), items, 9); err != nil {
		t.Fatal(err)
	}
	if _, err := cli.BatchMove(context.Background(), items, 9); err != nil {
		t.Fatal(err)
	}
	result, err := cli.BatchDelete(context.Background(), items)
	if err != nil {
		t.Fatal(err)
	}
	if result.OperationID != "op-1" || len(result.DeletedIDs) != 2 {
		t.Fatalf("unexpected delete result: %+v", result)
	}
	want := []string{
		"/api/v1/nodes/batch/copy",
		"/api/v1/nodes/batch/move",
		"/api/v1/nodes/batch/delete",
	}
	if len(calls) != len(want) {
		t.Fatalf("calls=%v", calls)
	}
	for index := range want {
		if calls[index] != want[index] {
			t.Fatalf("call[%d]=%q want=%q", index, calls[index], want[index])
		}
	}
}
