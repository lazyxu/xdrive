package localbackupipc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOwnerMoveNodeRequiresCurrentRevisionAndVerifiedTarget(t *testing.T) {
	calls := 0
	target := uint64(29)
	replyRevision := uint64(8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodPatch || r.URL.String() != "/v1/cloud/move" ||
			r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			t.Errorf("wrong Agent move route %s %s", r.Method, r.URL.String())
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		var input map[string]any
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil || len(input) != 3 ||
			input["id"] != float64(42) || input["revision"] != float64(7) ||
			input["parent_id"] != float64(29) {
			t.Errorf("unexpected move selector %+v", input)
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": 42, "parent_id": target, "name": "a.txt", "type": "file",
			"size": 8, "revision": replyRevision,
			"created_at": time.Now().UTC(), "updated_at": time.Now().UTC(),
		})
	}))
	defer server.Close()
	agent := &Client{baseURL: server.URL, token: strings.Repeat("a", 64), http: server.Client()}
	if _, err := agent.OwnerMoveNode(context.Background(), 42, 7, 17, 29, "file", "a.txt"); err == nil || calls != 0 {
		t.Fatal("Agent missing move capability contacted Server")
	}
	agent.capabilities = []string{"cloud-node-move"}
	for _, input := range []struct {
		id, revision, from, to uint64
		kind, name             string
	}{
		{0, 7, 17, 29, "file", "a.txt"},
		{42, 0, 17, 29, "file", "a.txt"},
		{42, 7, 29, 29, "file", "a.txt"},
		{42, 7, 17, 42, "dir", "a.txt"},
		{42, 7, 17, 29, "link", "a.txt"},
		{42, 7, 17, 29, "file", "../a.txt"},
	} {
		if _, err := agent.OwnerMoveNode(context.Background(),
			input.id, input.revision, input.from, input.to, input.kind, input.name); err == nil {
			t.Fatalf("unsafe move selector accepted: %+v", input)
		}
	}
	if calls != 0 {
		t.Fatal("invalid Owner move selector contacted Agent")
	}
	moved, err := agent.OwnerMoveNode(context.Background(), 42, 7, 17, 29, "file", "a.txt")
	if err != nil || moved.ID != 42 || moved.Revision != 8 ||
		moved.ParentID == nil || *moved.ParentID != 29 || calls != 1 {
		t.Fatalf("valid move failed: %+v, %v", moved, err)
	}
	replyRevision = 7
	if _, err := agent.OwnerMoveNode(context.Background(), 42, 7, 17, 29, "file", "a.txt"); err == nil {
		t.Fatal("stale revision was accepted as successful move")
	}
	replyRevision = 8
	target = 99
	if _, err := agent.OwnerMoveNode(context.Background(), 42, 7, 17, 29, "file", "a.txt"); err == nil {
		t.Fatal("cross-parent Server acknowledgment was accepted")
	}
	if calls != 3 {
		t.Fatalf("wrong Agent move dispatch count %d", calls)
	}
}
