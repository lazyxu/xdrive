package synologyui

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeOwnerFilesReader struct {
	*fakeAgent
	rootReads    int
	pageReads    int
	previewReads int
	forgeParent  bool
	forgePreview bool
}

func (f *fakeOwnerFilesReader) OwnerFileRoot(context.Context) (localbackupipc.OwnerFileNode, error) {
	f.rootReads++
	return localbackupipc.OwnerFileNode{
		ID: 17, Name: "Cloud", Type: "dir", Revision: 1, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}, nil
}
func (f *fakeOwnerFilesReader) OwnerFilePage(_ context.Context, parent uint64, limit int, sort, order, cursor string) (localbackupipc.OwnerFilesPage, error) {
	f.pageReads++
	p := parent
	if f.forgeParent {
		p = 99
	}
	return localbackupipc.OwnerFilesPage{
		Items: []localbackupipc.OwnerFileNode{{ID: 42, ParentID: &p, Name: "Photo.jpg", Type: "file",
			Revision: 1, Size: 1500, CreatedAt: time.Now(), UpdatedAt: time.Now()}},
		Sort: sort, Order: order,
	}, nil
}

func (f *fakeOwnerFilesReader) OwnerFileTextPreview(_ context.Context, id uint64) (localbackupipc.OwnerTextPreview, error) {
	f.previewReads++
	if id != 42 {
		return localbackupipc.OwnerTextPreview{}, errors.New("Server Owner text file not found")
	}
	if f.forgePreview {
		return localbackupipc.OwnerTextPreview{Text: "unsafe", Size: -1}, nil
	}
	return localbackupipc.OwnerTextPreview{Text: "Preview", Size: 7}, nil
}

func TestDSMOwnerFileCGIIsFixedGETAndRequiresCurrentDSMUser(t *testing.T) {
	g, native := newFixture(t)
	owner := &fakeOwnerFilesReader{fakeAgent: native}
	g.Connect = func(context.Context) (Agent, error) { return owner, nil }
	requestCGI := func(method, query string, withCookie bool) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "https://nas.example:5001"+DSMCGIPath+query, nil)
		if withCookie {
			r.Header.Set("Cookie", "id=dsm-session")
		}
		w := httptest.NewRecorder()
		CGIHandler(g).ServeHTTP(w, r)
		return w
	}
	if w := requestCGI("GET", "?op=cloud-root", true); w.Code != http.StatusOK ||
		!strings.Contains(w.Body.String(), `"id":17`) {
		t.Fatalf("Owner root failed: HTTP %d %s", w.Code, w.Body.String())
	}
	okQuery := "?op=cloud-children&parent_id=17&limit=200&sort=name&order=asc"
	if w := requestCGI("GET", okQuery, true); w.Code != http.StatusOK ||
		!strings.Contains(w.Body.String(), `"parent_id":17`) {
		t.Fatalf("Owner page failed: HTTP %d %s", w.Code, w.Body.String())
	}
	previewQuery := "?op=cloud-text-preview&node_id=42"
	if w := requestCGI("GET", previewQuery, true); w.Code != http.StatusOK ||
		!strings.Contains(w.Body.String(), `"text":"Preview"`) {
		t.Fatalf("Owner preview failed: HTTP %d %s", w.Code, w.Body.String())
	}
	if owner.rootReads != 1 || owner.pageReads != 1 || owner.previewReads != 1 ||
		native.runs != 0 || native.controls != 0 {
		t.Fatal("read-only Owner file path triggered unplanned native backup work")
	}
	for _, q := range []string{
		"?op=cloud-root&path=/volume1",
		"?op=cloud-root&op=run",
		"?op=cloud-children&parent_id=17&parent_id=18&limit=200&sort=name&order=asc",
		"?op=cloud-children&parent_id=017&limit=200&sort=name&order=asc",
		"?op=cloud-children&parent_id=0&limit=200&sort=name&order=asc",
		"?op=cloud-children&parent_id=17&limit=0&sort=name&order=asc",
		"?op=cloud-children&parent_id=17&limit=201&sort=name&order=asc",
		"?op=cloud-children&parent_id=17&limit=200&sort=bad&order=asc",
		"?op=cloud-children&parent_id=17&limit=200&sort=name&order=bad",
		"?op=cloud-children&parent_id=17&limit=200&sort=name&order=asc&cursor=",
		"?op=cloud-children&parent_id=17&limit=200&sort=name&order=asc&action=delete",
		"?op=cloud-children&parent_id=17&limit=200&sort=name&order=asc&cursor=a%0Ab",
		"?op=cloud-children&parent_id=17&limit=200&sort=name&order=asc;op=run",
		"?op=cloud-download&parent_id=17",
		"?op=cloud-text-preview",
		"?op=cloud-text-preview&node_id=0",
		"?op=cloud-text-preview&node_id=042",
		"?op=cloud-text-preview&node_id=42&node_id=43",
		"?op=cloud-text-preview&node_id=42&path=/volume1/private",
		"?op=cloud-text-preview&node_id=42&file_url=https://other.example",
		"?op=cloud-text-preview&node_id=42;op=run",
		"?op=cloud-text-preview&node_id=42%0Afile",
		"?op=cloud-text-preview&node_id=9007199254740992",
	} {
		if w := requestCGI("GET", q, true); w.Code == http.StatusOK {
			t.Fatalf("unapproved DSM cloud file selector accepted: %s", q)
		}
	}
	if w := requestCGI("POST", previewQuery, true); w.Code == http.StatusOK {
		t.Fatal("Owner text preview accepted non-GET method")
	}
	if w := requestCGI("POST", okQuery, true); w.Code == http.StatusOK {
		t.Fatal("Owner cloud file write accepted")
	}
	if w := requestCGI("GET", okQuery, false); w.Code == http.StatusOK {
		t.Fatal("file read bypassed DSM session")
	}
	if owner.rootReads != 1 || owner.pageReads != 1 || owner.previewReads != 1 {
		t.Fatal("unsafe selectors reached private Agent")
	}
	owner.forgePreview = true
	if w := requestCGI("GET", previewQuery, true); w.Code == http.StatusOK {
		t.Fatal("oversized or unsafe Owner text projection reached DSM")
	}
	owner.forgePreview = false
	if w := requestCGI("GET", previewQuery, false); w.Code == http.StatusOK {
		t.Fatal("text preview bypassed per-request DSM authentication")
	}
	owner.forgeParent = true
	if w := requestCGI("GET", okQuery, true); w.Code == http.StatusOK {
		t.Fatal("foreign ParentID leaked to DSM")
	}
	g.Authenticate = func(context.Context) (string, error) { return "other", nil }
	if w := requestCGI("GET", "?op=cloud-root", true); w.Code != http.StatusForbidden {
		t.Fatal("different DSM user read Server Owner cloud data")
	}
}

func TestOldAgentDoesNotPretendToHaveCloudFiles(t *testing.T) {
	g, native := newFixture(t)
	for _, path := range []string{"/v1/cloud-root", "/v1/cloud-children?parent_id=17&limit=200&sort=name&order=asc", "/v1/cloud-text-preview?node_id=42"} {
		w := request(g, "GET", path, "", "")
		if w.Code != http.StatusNotImplemented {
			t.Fatalf("old Agent wrongly advertised Owner cloud files %s: %d", path, w.Code)
		}
	}
	if native.runs != 0 || native.controls != 0 {
		t.Fatal("fallback performed unrequested native operation")
	}
}
