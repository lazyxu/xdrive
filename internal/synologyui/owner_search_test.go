package synologyui

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeDSMOwnerSearch struct {
	*fakeAgent
	reads     int
	malformed bool
}

func (a *fakeDSMOwnerSearch) OwnerSearchPage(_ context.Context, query, cursor string) (localbackupipc.OwnerSearchPage, error) {
	a.reads++
	if query != "family" || cursor != "" {
		panic("unexpected Owner search selector")
	}
	parent := uint64(17)
	if a.malformed {
		parent = 99
	}
	now := time.Now()
	return localbackupipc.OwnerSearchPage{
		Items: []localbackupipc.OwnerSearchHit{{
			Node: localbackupipc.OwnerFileNode{
				ID: 42, ParentID: &parent, Name: "family.jpg", Type: "file",
				Size: 1200, Revision: 1, CreatedAt: now, UpdatedAt: now,
			},
			Crumbs: []localbackupipc.OwnerSearchCrumb{{ID: 1, Name: "Cloud"}, {ID: 17, Name: "Photos"}},
		}},
	}, nil
}

func TestDSMOwnerSearchIsAnAuthenticatedExactGET(t *testing.T) {
	g, native := newFixture(t)
	owner := &fakeDSMOwnerSearch{fakeAgent: native}
	g.Connect = func(context.Context) (Agent, error) { return owner, nil }
	requestSearch := func(method, query string, withCookie bool) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "https://nas.example:5001"+DSMCGIPath+query, nil)
		if withCookie {
			r.Header.Set("Cookie", "id=dsm-session")
		}
		w := httptest.NewRecorder()
		CGIHandler(g).ServeHTTP(w, r)
		return w
	}
	if w := requestSearch(http.MethodGet, "?op=cloud-search&q=family", true); w.Code != http.StatusOK ||
		!strings.Contains(w.Body.String(), `"name":"family.jpg"`) {
		t.Fatalf("Owner search failed: HTTP %d %s", w.Code, w.Body.String())
	}
	if owner.reads != 1 {
		t.Fatal("no Owner search request delivered")
	}
	for _, query := range []string{
		"?op=cloud-search", "?op=cloud-search&q=a",
		"?op=cloud-search&q=family&q=other", "?op=cloud-search&q=family&path=/volume1",
		"?op=cloud-search&q=family&cursor=", "?op=cloud-search&q=family&cursor=bad%0Avalue",
		"?op=cloud-search&q=family&op=run",
	} {
		if w := requestSearch(http.MethodGet, query, true); w.Code == http.StatusOK {
			t.Fatalf("unsafe search selector admitted: %s", query)
		}
	}
	if w := requestSearch(http.MethodPost, "?op=cloud-search&q=family", true); w.Code == http.StatusOK {
		t.Fatal("Owner search accidentally accepts writes")
	}
	if w := requestSearch(http.MethodGet, "?op=cloud-search&q=family", false); w.Code == http.StatusOK {
		t.Fatal("Owner search bypassed DSM authentication")
	}
	if owner.reads != 1 {
		t.Fatalf("unsafe selectors contacted Agent %d times", owner.reads)
	}
	owner.malformed = true
	if w := requestSearch(http.MethodGet, "?op=cloud-search&q=family", true); w.Code == http.StatusOK {
		t.Fatal("foreign search breadcrumb was accepted")
	}
	g.Connect = func(context.Context) (Agent, error) { return native, nil }
	if w := requestSearch(http.MethodGet, "?op=cloud-search&q=family", true); w.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent falsely claimed search support: HTTP %d", w.Code)
	}
}
