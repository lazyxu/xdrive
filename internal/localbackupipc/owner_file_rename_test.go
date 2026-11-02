package localbackupipc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOwnerRenameNodeRequiresCapabilityAndRevisionCheckedSameParent(t *testing.T) {
	writes := 0
	revision := uint64(2)
	parent := uint64(17)
	kind := "file"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writes++
		if r.Method != http.MethodPatch || r.URL.String() != "/v1/cloud/nodes" ||
			r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			t.Errorf("unexpected native Agent rename: %s %s", r.Method, r.URL.String())
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		var input map[string]any
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil ||
			len(input) != 3 || input["id"] != float64(42) ||
			input["revision"] != float64(1) || input["name"] != "照片.jpg" {
			t.Errorf("unexpected Server Owner rename payload: %+v %v", input, err)
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w,
			"{\"id\":42,\"parent_id\":%d,\"name\":\"照片.jpg\",\"type\":%q,\"size\":123,\"revision\":%d,\"created_at\":\"2026-11-02T00:00:00Z\",\"updated_at\":\"2026-11-02T00:00:02Z\"}",
			parent, kind, revision)
	}))
	defer server.Close()
	agent := &Client{baseURL: server.URL, token: strings.Repeat("a", 64), http: server.Client()}
	if _, err := agent.OwnerRenameNode(context.Background(), 42, 1, 17, "file", "照片.jpg"); err == nil || writes != 0 {
		t.Fatal("Agent without cloud-node-rename contacted native Server")
	}
	agent.capabilities = []string{"cloud-node-rename"}
	for _, bad := range []struct {
		id, rev, parent uint64
		kind, name      string
	}{
		{0, 1, 17, "file", "照片.jpg"},
		{MaxSafeSourceID + 1, 1, 17, "file", "照片.jpg"},
		{42, 0, 17, "file", "照片.jpg"},
		{42, MaxSafeSourceID + 1, 17, "file", "照片.jpg"},
		{42, 1, 0, "file", "照片.jpg"},
		{42, 1, 17, "symlink", "照片.jpg"},
		{42, 1, 17, "file", "../private"},
		{42, 1, 17, "file", "bad\nname"},
		{42, 1, 17, "file", strings.Repeat("x", 256)},
	} {
		if _, err := agent.OwnerRenameNode(context.Background(),
			bad.id, bad.rev, bad.parent, bad.kind, bad.name); err == nil {
			t.Fatalf("invalid rename selector was allowed: %+v", bad)
		}
	}
	if writes != 0 {
		t.Fatalf("invalid selectors contacted Agent %d times", writes)
	}
	renamed, err := agent.OwnerRenameNode(context.Background(), 42, 1, 17, "file", "照片.jpg")
	if err != nil || renamed.ID != 42 || renamed.Revision != 2 ||
		renamed.ParentID == nil || *renamed.ParentID != 17 || writes != 1 {
		t.Fatalf("valid rename was rejected: %+v, err=%v writes=%d", renamed, err, writes)
	}
	revision = 1
	if _, err := agent.OwnerRenameNode(context.Background(), 42, 1, 17, "file", "照片.jpg"); err == nil {
		t.Fatal("stale Server revision was accepted")
	}
	parent = 99
	revision = 2
	if _, err := agent.OwnerRenameNode(context.Background(), 42, 1, 17, "file", "照片.jpg"); err == nil {
		t.Fatal("cross-parent Server rename response was accepted")
	}
	parent = 17
	kind = "dir"
	if _, err := agent.OwnerRenameNode(context.Background(), 42, 1, 17, "file", "照片.jpg"); err == nil {
		t.Fatal("cross-kind Server rename response was accepted")
	}
	if writes != 4 {
		t.Fatalf("wrong number of native requests %d", writes)
	}
}

func TestValidateOwnerRenamedNodeRejectsFabricatedEvidence(t *testing.T) {
	id := uint64(42)
	parent := uint64(17)
	n := OwnerFileNode{
		ID: id, ParentID: &parent, Name: "file.txt", Type: "file", Size: 100,
		Revision: 2,
	}
	if ValidateOwnerRenamedNode(n, id, 1, parent, "file", "file.txt") {
		t.Fatal("missing timestamps admitted")
	}
}
