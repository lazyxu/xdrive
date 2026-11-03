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

func TestOwnerCopyNodeAdmitsOnlyOriginalServerCopyAndVerifiesReceipt(t *testing.T) {
	calls := 0
	target := uint64(29)
	newID := uint64(77)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodPost || r.URL.String() != "/v1/cloud/copy" ||
			r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			t.Errorf("unexpected Owner copy route %s %s", r.Method, r.URL.String())
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		var input map[string]any
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil || len(input) != 2 ||
			input["id"] != float64(42) || input["parent_id"] != float64(29) {
			t.Errorf("unexpected original Agent copy arguments %+v", input)
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": newID, "parent_id": target, "name": "a (1).txt", "type": "file",
			"size": 8, "revision": 1,
			"created_at": time.Now().UTC(), "updated_at": time.Now().UTC(),
		})
	}))
	defer server.Close()
	agent := &Client{baseURL: server.URL, token: strings.Repeat("a", 64), http: server.Client()}
	if _, err := agent.OwnerCopyNode(context.Background(), 42, 7, 17, 29, "file", "a.txt"); err == nil {
		t.Fatal("Agent missing explicit copy capability admitted operation")
	}
	agent.capabilities = []string{"cloud-node-copy"}
	for _, x := range []struct {
		id, revision, source, destination uint64
		kind, name                        string
	}{
		{0, 7, 17, 29, "file", "a.txt"},
		{42, 0, 17, 29, "file", "a.txt"},
		{42, 7, 29, 29, "file", "a.txt"},
		{42, 7, 17, 42, "file", "a.txt"},
		{42, 7, 17, 29, "link", "a.txt"},
		{42, 7, 17, 29, "file", "../a.txt"},
	} {
		if _, err := agent.OwnerCopyNode(context.Background(),
			x.id, x.revision, x.source, x.destination, x.kind, x.name); err == nil {
			t.Fatalf("invalid copy selector admitted: %+v", x)
		}
	}
	if calls != 0 {
		t.Fatal("unsupported/invalid copy contacted Server")
	}
	result, err := agent.OwnerCopyNode(context.Background(), 42, 7, 17, 29, "file", "a.txt")
	if err != nil || result.ID != 77 || result.ParentID == nil || *result.ParentID != 29 ||
		result.Name != "a (1).txt" || calls != 1 {
		t.Fatalf("valid Server copy receipt not accepted: %+v, %v", result, err)
	}
	target = 99
	if _, err := agent.OwnerCopyNode(context.Background(), 42, 7, 17, 29, "file", "a.txt"); err == nil {
		t.Fatal("foreign destination receipt admitted")
	}
	target = 29
	newID = 42
	if _, err := agent.OwnerCopyNode(context.Background(), 42, 7, 17, 29, "file", "a.txt"); err == nil {
		t.Fatal("original node falsely accepted as successful copy")
	}
}
