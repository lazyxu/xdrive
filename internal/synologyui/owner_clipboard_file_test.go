package synologyui

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type dsmClipboardFileFixture struct {
	*fakeAgent
	reads       int
	owner       string
	malformed   bool
	switchOwner bool
	connections int
}

func (*dsmClipboardFileFixture) OwnerClipboardAvailable() bool { return true }
func (*dsmClipboardFileFixture) OwnerClipboardVault(context.Context) (client.ClipboardVault, error) {
	return client.ClipboardVault{}, nil
}
func (*dsmClipboardFileFixture) OwnerClipboardCheck(context.Context, client.ClipboardCheck) (client.ClipboardVault, error) {
	return client.ClipboardVault{}, nil
}
func (*dsmClipboardFileFixture) OwnerClipboardList(context.Context, uint64) (client.ClipboardPage, error) {
	return client.ClipboardPage{}, nil
}
func (*dsmClipboardFileFixture) OwnerClipboardCreate(context.Context, client.ClipboardWrite) (client.ClipboardItem, error) {
	return client.ClipboardItem{}, nil
}
func (*dsmClipboardFileFixture) OwnerClipboardDelete(context.Context, uint64) error { return nil }
func (*dsmClipboardFileFixture) OwnerClipboardClear(context.Context) error          { return nil }
func (f *dsmClipboardFileFixture) ServerConnection(context.Context) (localbackupipc.ServerConnection, error) {
	f.connections++
	name := f.owner
	if f.switchOwner && f.connections%2 == 0 {
		name = "other-owner"
	}
	return localbackupipc.ServerConnection{
		Configured: true, Server: "https://drive.example", Username: name,
	}, nil
}
func (*dsmClipboardFileFixture) LoginServer(context.Context, string, string, string) error {
	return errors.New("no login over Clipboard")
}
func (f *dsmClipboardFileFixture) OwnerClipboardFileReference(_ context.Context, id uint64) (localbackupipc.OwnerClipboardFileReference, error) {
	f.reads++
	parent := uint64(17)
	now := time.Date(2026, 11, 9, 0, 0, 0, 0, time.UTC)
	rev := uint64(4)
	if f.malformed {
		rev = 0
	}
	return localbackupipc.OwnerClipboardFileReference{
		Node: localbackupipc.OwnerFileNode{
			ID: id, ParentID: &parent, Name: "photo.jpg", Type: "file",
			Size: 100, Revision: rev, CreatedAt: now, UpdatedAt: now,
		},
		Crumbs: []localbackupipc.OwnerSearchCrumb{
			{ID: 1, Name: "Cloud"},
			{ID: 17, Name: "Pictures"},
			{ID: id, Name: "photo.jpg"},
		},
	}, nil
}

func TestDSMClipboardFileReferenceRequiresAuthenticatedNarrowCGIAndOwner(t *testing.T) {
	g, old := newFixture(t)
	f := &dsmClipboardFileFixture{fakeAgent: old, owner: "alice"}
	g.Connect = func(context.Context) (Agent, error) { return f, nil }
	handler := CGIHandler(g)
	request := func(method, query string, cookie bool) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "https://nas.example:5001"+DSMCGIPath+query, nil)
		if cookie {
			r.Header.Set("Cookie", "id=dsm-session")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	valid := request(http.MethodGet, "?op=cloud-clipboard-file&node_id=118", true)
	if valid.Code != http.StatusOK ||
		!strings.Contains(valid.Body.String(), `"name":"photo.jpg"`) || f.reads != 1 {
		t.Fatalf("verified Owner Files read failed %d %s", valid.Code, valid.Body.String())
	}
	for _, query := range []string{
		"?op=cloud-clipboard-file",
		"?op=cloud-clipboard-file&node_id=0",
		"?op=cloud-clipboard-file&node_id=-1",
		"?op=cloud-clipboard-file&node_id=0118",
		"?op=cloud-clipboard-file&node_id=118&node_id=119",
		"?op=cloud-clipboard-file&node_id=118&path=/volume1",
		"?op=cloud-clipboard-file&node_id=118&device_token=secret",
		"?op=cloud-clipboard-file&node_id=118&op=cloud-search",
	} {
		if response := request(http.MethodGet, query, true); response.Code == http.StatusOK {
			t.Fatalf("unsafe Files selector admitted: %s", query)
		}
	}
	if response := request(http.MethodGet, "?op=cloud-clipboard-file&node_id=118", false); response.Code == http.StatusOK {
		t.Fatal("a missing DSM session was admitted")
	}
	if response := request(http.MethodPost, "?op=cloud-clipboard-file&node_id=118", true); response.Code == http.StatusOK {
		t.Fatal("Clipboard Files read unexpectedly allowed POST")
	}
	if f.reads != 1 {
		t.Fatalf("invalid callers reached Agent %d times", f.reads)
	}
	f.malformed = true
	if response := request(http.MethodGet, "?op=cloud-clipboard-file&node_id=118", true); response.Code == http.StatusOK {
		t.Fatal("malformed file revision was admitted")
	}
	f.malformed = false
	f.switchOwner = true
	f.connections = 0
	if response := request(http.MethodGet, "?op=cloud-clipboard-file&node_id=118", true); response.Code == http.StatusOK {
		t.Fatal("Owner switch returned the old Owner's file")
	}
	g.Connect = func(context.Context) (Agent, error) { return old, nil }
	if response := request(http.MethodGet, "?op=cloud-clipboard-file&node_id=118", true); response.Code != http.StatusNotImplemented {
		t.Fatalf("older Agent falsely gained Viewer permission: %d", response.Code)
	}
}
