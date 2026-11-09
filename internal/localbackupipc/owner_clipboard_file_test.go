package localbackupipc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func testOwnerClipboardReference() OwnerClipboardFileReference {
	parent := uint64(17)
	now := time.Date(2026, 11, 9, 0, 0, 0, 0, time.UTC)
	return OwnerClipboardFileReference{
		Node: OwnerFileNode{
			ID: 118, ParentID: &parent, Name: "photo.jpg",
			Type: "file", Size: 1234, Revision: 4,
			CreatedAt: now, UpdatedAt: now,
		},
		Crumbs: []OwnerSearchCrumb{
			{ID: 1, Name: "Cloud"},
			{ID: 17, Name: "Photos"},
			{ID: 118, Name: "photo.jpg"},
		},
	}
}

func TestOwnerClipboardFileReferenceRequiresLiveExactNodeAndParent(t *testing.T) {
	base := testOwnerClipboardReference()
	if !ValidateOwnerClipboardFileReference(base, 118) {
		t.Fatal("valid current Owner file reference rejected")
	}
	mutations := []func(*OwnerClipboardFileReference){
		func(v *OwnerClipboardFileReference) { v.Node.ID = 119 },
		func(v *OwnerClipboardFileReference) { v.Node.ParentID = nil },
		func(v *OwnerClipboardFileReference) { parent := uint64(99); v.Node.ParentID = &parent },
		func(v *OwnerClipboardFileReference) { v.Node.Type = "dir" },
		func(v *OwnerClipboardFileReference) { v.Node.Revision = 0 },
		func(v *OwnerClipboardFileReference) { v.Node.Size = -1 },
		func(v *OwnerClipboardFileReference) { v.Node.CreatedAt = time.Time{} },
		func(v *OwnerClipboardFileReference) { v.Crumbs[2].Name = "renamed.jpg" },
		func(v *OwnerClipboardFileReference) { v.Crumbs[1].ID = 99 },
		func(v *OwnerClipboardFileReference) { v.Crumbs[2].ID = 17 },
		func(v *OwnerClipboardFileReference) { v.Crumbs = v.Crumbs[:1] },
	}
	for index, mutate := range mutations {
		v := testOwnerClipboardReference()
		mutate(&v)
		if ValidateOwnerClipboardFileReference(v, 118) {
			t.Fatalf("unsafe Owner file projection %d accepted", index)
		}
	}
	if ValidateOwnerClipboardFileReference(base, 0) ||
		ValidateOwnerClipboardFileReference(base, 119) {
		t.Fatal("foreign or empty requested Node accepted")
	}
}

func TestOwnerClipboardFilesIPCRequiresAllCapabilitiesAndRejectsStaleRead(t *testing.T) {
	n := 0
	invalid := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n++
		if r.Method != http.MethodGet || r.URL.Path != "/v1/cloud/clipboard-file" ||
			r.URL.RawQuery != "node_id=118" ||
			r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			t.Errorf("untrusted Agent Files IPC request: %s %s", r.Method, r.URL.String())
			http.Error(w, "bad endpoint", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		parent := 17
		if invalid {
			parent = 99
		}
		_, _ = w.Write([]byte(`{"node":{"id":118,"parent_id":` + strconv.Itoa(parent) +
			`,"name":"photo.jpg","type":"file","size":1234,"revision":4,"created_at":"2026-11-09T00:00:00Z","updated_at":"2026-11-09T00:00:00Z"},"crumbs":[{"id":1,"name":"Cloud"},{"id":17,"name":"Photos"},{"id":118,"name":"photo.jpg"}]}`))
	}))
	defer server.Close()

	client := &Client{baseURL: server.URL, token: strings.Repeat("a", 64), http: server.Client()}
	for _, missing := range [][]string{
		{}, {"cloud-clipboard"}, {"cloud-clipboard", "cloud-files-read"},
	} {
		client.capabilities = missing
		if _, err := client.OwnerClipboardFileReference(context.Background(), 118); err == nil {
			t.Fatalf("missing capabilities %v unexpectedly granted file access", missing)
		}
	}
	if n != 0 {
		t.Fatal("missing capability must not contact owning Agent")
	}
	client.capabilities = []string{"cloud-clipboard", "cloud-files-read", "node-location"}
	for _, id := range []uint64{0, MaxSafeSourceID + 1} {
		if _, err := client.OwnerClipboardFileReference(context.Background(), id); err == nil {
			t.Fatal("invalid Node ID was admitted")
		}
	}
	if n != 0 {
		t.Fatal("invalid Node must not contact owning Agent")
	}
	ref, err := client.OwnerClipboardFileReference(context.Background(), 118)
	if err != nil || ref.Node.ID != 118 || n != 1 {
		t.Fatalf("current Owner file lookup failed: %+v %v", ref, err)
	}
	invalid = true
	if _, err := client.OwnerClipboardFileReference(context.Background(), 118); err == nil || n != 2 {
		t.Fatalf("cross-parent/renamed reference must fail closed: %v", err)
	}
}
