package localbackupipc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestOwnerFileProjectionRejectsForeignSourceAndUnsafeInteger(t *testing.T) {
	parent := uint64(17)
	valid := client.Node{ID: 42, ParentID: &parent, Name: "Photo.jpg",
		Type: "file", Size: 1500, Revision: 1, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	n, err := ownerFileNode(valid, &parent)
	if err != nil || n.ID != 42 || n.ParentID == nil || *n.ParentID != parent {
		t.Fatalf("valid Owner folder projection unavailable: %+v %v", n, err)
	}
	if !ValidateOwnerFilesPage(OwnerFilesPage{
		Items: []OwnerFileNode{n}, Sort: "name", Order: "asc",
	}, parent, 200, "name", "asc", "") {
		t.Fatal("valid Owner folder page was rejected")
	}
	for _, mutate := range []func(*client.Node){
		func(n *client.Node) { n.ID = MaxSafeSourceID + 1 },
		func(n *client.Node) { n.ParentID = nil },
		func(n *client.Node) { x := uint64(99); n.ParentID = &x },
		func(n *client.Node) { n.Size = -1 },
		func(n *client.Node) { n.Size = int64(MaxSafeSourceID) + 1 },
		func(n *client.Node) { n.Type = "symlink" },
		func(n *client.Node) { n.Name = "" },
		func(n *client.Node) { n.Revision = 0 },
		func(n *client.Node) { n.DeletedAt = new(time.Time) },
	} {
		changed := valid
		mutate(&changed)
		if _, err := ownerFileNode(changed, &parent); err == nil {
			t.Fatal("unsafe server node was projected into DSM")
		}
	}
	if ValidateOwnerFilesPage(OwnerFilesPage{
		Items: []OwnerFileNode{n, n}, Sort: "name", Order: "asc",
	}, parent, 200, "name", "asc", "") {
		t.Fatal("duplicate Owner node was accepted")
	}
	if ValidateOwnerFilesPage(OwnerFilesPage{
		Items: []OwnerFileNode{n}, HasMore: true, Sort: "name", Order: "asc", NextCursor: "same",
	}, parent, 200, "name", "asc", "same") {
		t.Fatal("repeated page cursor was accepted")
	}
}

func TestOwnerFileAgentReadRequiresCapabilityAndFixedGETOnlyIPC(t *testing.T) {
	reads := 0
	now := "2026-10-26T00:00:00Z"
	var malformed bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads++
		if r.Method != http.MethodGet ||
			r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			t.Error("wrong method or lost native Agent bearer")
			http.Error(w, "unavailable", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/cloud/root":
			if r.URL.RawQuery != "" {
				t.Error("root used a caller-controlled query")
			}
			_, _ = w.Write([]byte(`{"id":17,"name":"Cloud","type":"dir","revision":1,"created_at":"` + now + `","updated_at":"` + now + `"}`))
		case "/v1/cloud/children":
			if r.URL.Query().Get("parent_id") != "17" ||
				r.URL.Query().Get("limit") != "200" ||
				r.URL.Query().Get("sort") != "name" ||
				r.URL.Query().Get("order") != "asc" {
				t.Error("unexpected Owner cloud child query")
			}
			parent := "17"
			if malformed {
				parent = "99"
			}
			_, _ = w.Write([]byte(`{"items":[{"id":42,"parent_id":` + parent + `,"name":"Photo.jpg","type":"file","size":1500,"revision":1,"created_at":"` + now + `","updated_at":"` + now + `"}],"has_more":false,"sort":"name","order":"asc"}`))
		default:
			t.Errorf("unexpected native Agent endpoint: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	agent := &Client{baseURL: server.URL, token: strings.Repeat("a", 64), http: server.Client()}
	if _, err := agent.OwnerFileRoot(context.Background()); err == nil {
		t.Fatal("Agent without cloud-files-read unexpectedly read Server root")
	}
	if _, err := agent.OwnerFilePage(context.Background(), 17, 200, "name", "asc", ""); err == nil {
		t.Fatal("Agent without cloud-files-read unexpectedly read child page")
	}
	if reads != 0 {
		t.Fatal("missing capability contacted local Agent")
	}
	agent.capabilities = []string{"cloud-files-read"}
	if root, err := agent.OwnerFileRoot(context.Background()); err != nil || root.ID != 17 {
		t.Fatalf("Owner root unavailable: %+v %v", root, err)
	}
	if page, err := agent.OwnerFilePage(context.Background(), 17, 200, "name", "asc", ""); err != nil ||
		len(page.Items) != 1 || page.Items[0].ParentID == nil || *page.Items[0].ParentID != 17 {
		t.Fatalf("Owner file page unavailable: %+v %v", page, err)
	}
	for _, bad := range []struct {
		id                  uint64
		limit               int
		sort, order, cursor string
	}{
		{0, 200, "name", "asc", ""},
		{MaxSafeSourceID + 1, 200, "name", "asc", ""},
		{17, 201, "name", "asc", ""},
		{17, 200, "newest", "asc", ""},
		{17, 200, "name", "random", ""},
		{17, 200, "name", "asc", "unsafe\r\ncursor"},
		{17, 200, "name", "asc", strings.Repeat("x", 1025)},
	} {
		if _, err := agent.OwnerFilePage(context.Background(), bad.id, bad.limit, bad.sort, bad.order, bad.cursor); err == nil {
			t.Fatal("unsafe Owner file request allowed")
		}
	}
	if reads != 2 {
		t.Fatalf("malformed selectors reached Agent (%d requests)", reads)
	}
	malformed = true
	if _, err := agent.OwnerFilePage(context.Background(), 17, 200, "name", "asc", ""); err == nil {
		t.Fatal("cross-parent Server result was admitted")
	}
}
