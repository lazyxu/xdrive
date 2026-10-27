package synologyui

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeDSMOwnerMediaReader struct {
	*fakeOwnerFilesReader
	hits    int
	corrupt bool
}

func (f *fakeDSMOwnerMediaReader) OwnerFileMediaRange(
	_ context.Context, nodeID, revision uint64, offset int64, length int,
) (localbackupipc.OwnerMediaRange, error) {
	f.hits++
	if nodeID != 42 || revision != 7 || offset != 4 || length != 4 {
		return localbackupipc.OwnerMediaRange{}, context.Canceled
	}
	out := localbackupipc.OwnerMediaRange{
		Offset: 4, Total: 10, Revision: 7,
		SHA256: strings.Repeat("a", 64), Data: []byte("4567"),
	}
	if f.corrupt {
		out.SHA256 = ""
	}
	return out, nil
}

func TestDSMOwnerMediaRangeRequiresSameUserAndCanonicalFixedGET(t *testing.T) {
	g, agent := newFixture(t)
	owner := &fakeDSMOwnerMediaReader{
		fakeOwnerFilesReader: &fakeOwnerFilesReader{fakeAgent: agent},
	}
	g.Connect = func(context.Context) (Agent, error) { return owner, nil }
	call := func(method, query string, cookie bool) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "https://nas.example:5001"+DSMCGIPath+query, nil)
		if cookie {
			r.Header.Set("Cookie", "id=dsm-session")
		}
		w := httptest.NewRecorder()
		CGIHandler(g).ServeHTTP(w, r)
		return w
	}
	query := "?op=cloud-media-range&node_id=42&revision=7&offset=4&length=4"
	w := call(http.MethodGet, query, true)
	if w.Code != http.StatusOK ||
		!strings.Contains(w.Body.String(), `"data":"NDU2Nw=="`) ||
		!strings.Contains(w.Body.String(), `"total":10`) ||
		strings.Contains(w.Body.String(), "Bearer") {
		t.Fatalf("real, bounded Owner media slice not available: HTTP %d %s", w.Code, w.Body.String())
	}
	if owner.hits != 1 || agent.controls != 0 || agent.runs != 0 {
		t.Fatal("unexpected owning Agent side effect")
	}
	for _, suffix := range []string{
		"?op=cloud-media-range",
		"?op=cloud-media-range&node_id=42&revision=7&offset=4",
		"?op=cloud-media-range&node_id=042&revision=7&offset=4&length=4",
		"?op=cloud-media-range&node_id=42&revision=07&offset=4&length=4",
		"?op=cloud-media-range&node_id=42&revision=7&offset=04&length=4",
		"?op=cloud-media-range&node_id=42&revision=7&offset=4&length=0",
		"?op=cloud-media-range&node_id=42&revision=7&offset=4&length=262145",
		"?op=cloud-media-range&node_id=42&revision=7&offset=4&length=4&url=https://private.example",
		"?op=cloud-media-range&node_id=42&revision=7&offset=4&length=4&node_id=99",
		"?op=cloud-media-range&node_id=42&revision=7&offset=-1&length=4",
		"?op=cloud-media-range&node_id=9007199254740992&revision=7&offset=4&length=4",
		"?op=cloud-media-range&node_id=42%0A&revision=7&offset=4&length=4",
		"?op=cloud-media-range&node_id=42&revision=7&offset=4&length=4;op=run",
	} {
		if bad := call(http.MethodGet, suffix, true); bad.Code == http.StatusOK {
			t.Fatalf("unsafe DSM Owner range accepted %s", suffix)
		}
	}
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
		if bad := call(method, query, true); bad.Code == http.StatusOK {
			t.Fatalf("Owner media slice became a write operation: %s", method)
		}
	}
	if bad := call(http.MethodGet, query, false); bad.Code == http.StatusOK {
		t.Fatal("Owner media range bypassed DSM session")
	}
	if owner.hits != 1 {
		t.Fatalf("unsafe requests reached original Agent (%d)", owner.hits)
	}
	owner.corrupt = true
	if bad := call(http.MethodGet, query, true); bad.Code == http.StatusOK {
		t.Fatal("corrupt Agent media bytes forwarded to DSM")
	}
	g.Authenticate = func(context.Context) (string, error) { return "other", nil }
	if bad := call(http.MethodGet, query, true); bad.Code != http.StatusForbidden {
		t.Fatal("DSM principal changed but Owner media read remained authorized")
	}
}

func TestOldDSMOwnerAgentHasNoMediaCapability(t *testing.T) {
	g, _ := newFixture(t)
	r := httptest.NewRequest(http.MethodGet,
		"https://nas.example:5001"+DSMCGIPath+
			"?op=cloud-media-range&node_id=42&revision=7&offset=4&length=4", nil)
	r.Header.Set("Cookie", "id=dsm-session")
	w := httptest.NewRecorder()
	CGIHandler(g).ServeHTTP(w, r)
	if w.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent falsely served media slices: %d", w.Code)
	}
}
