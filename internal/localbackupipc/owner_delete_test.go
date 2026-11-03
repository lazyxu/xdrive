package localbackupipc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOwnerDeleteNodeUsesExactExistingAgentTrashRoute(t *testing.T) {
	receipts := 0
	extraResponse := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receipts++
		if r.Method != http.MethodDelete ||
			r.URL.String() != "/v1/cloud/nodes" ||
			r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			t.Errorf("unexpected authenticated Agent trash route: %s %s", r.Method, r.URL.String())
			http.Error(w, "rejected", http.StatusForbidden)
			return
		}
		var input map[string]any
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil ||
			len(input) != 2 || input["id"] != float64(42) ||
			input["revision"] != float64(7) {
			t.Errorf("forged Agent trash input: %+v", input)
			http.Error(w, "invalid", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if extraResponse {
			_, _ = w.Write([]byte(`{"ok":true,"unverified":true}`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	agent := &Client{baseURL: server.URL, token: strings.Repeat("a", 64), http: server.Client()}
	if err := agent.OwnerDeleteNode(context.Background(), 42, 7, 17, "file", "report.txt"); err == nil {
		t.Fatal("Agent without delete capability was admitted")
	}
	agent.capabilities = []string{"cloud-node-delete"}
	for _, input := range []struct {
		id, revision, parent uint64
		kind, name           string
	}{
		{0, 7, 17, "file", "report.txt"},
		{42, 0, 17, "file", "report.txt"},
		{42, 7, 0, "file", "report.txt"},
		{42, 7, 17, "symlink", "report.txt"},
		{42, 7, 17, "file", "../escape"},
	} {
		if err := agent.OwnerDeleteNode(context.Background(),
			input.id, input.revision, input.parent, input.kind, input.name); err == nil {
			t.Fatalf("invalid Owner delete selector allowed: %+v", input)
		}
	}
	if receipts != 0 {
		t.Fatalf("invalid or unsupported delete contacted Server %d times", receipts)
	}
	if err := agent.OwnerDeleteNode(context.Background(), 42, 7, 17, "file", "report.txt"); err != nil {
		t.Fatalf("valid current Server Owner trash rejected: %v", err)
	}
	extraResponse = true
	if err := agent.OwnerDeleteNode(context.Background(), 42, 7, 17, "file", "report.txt"); err == nil {
		t.Fatal("forged successful Server acknowledgment accepted")
	}
	if receipts != 2 {
		t.Fatalf("unexpected native Agent trash dispatch count %d", receipts)
	}
}
