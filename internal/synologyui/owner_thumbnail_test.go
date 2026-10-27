package synologyui

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeDSMOwnerThumbnailReader struct {
	*fakeOwnerFilesReader
	reads int
	bad   bool
}

func (f *fakeDSMOwnerThumbnailReader) OwnerFileThumbnail(
	_ context.Context, id, revision uint64,
) (localbackupipc.OwnerThumbnail, error) {
	f.reads++
	if id != 42 || revision != 7 {
		return localbackupipc.OwnerThumbnail{}, context.Canceled
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		return localbackupipc.OwnerThumbnail{}, err
	}
	result := localbackupipc.OwnerThumbnail{
		ContentType: "image/png", AlphaState: "opaque", Data: buf.Bytes(),
	}
	if f.bad {
		result.ContentType = "text/html"
	}
	return result, nil
}

func TestDSMOwnerThumbnailIsAuthenticatedFixedReadNotPathProxy(t *testing.T) {
	g, native := newFixture(t)
	reader := &fakeDSMOwnerThumbnailReader{fakeOwnerFilesReader: &fakeOwnerFilesReader{fakeAgent: native}}
	g.Connect = func(context.Context) (Agent, error) { return reader, nil }
	call := func(method, query string, cookie bool) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "https://nas.example:5001"+DSMCGIPath+query, nil)
		if cookie {
			req.Header.Set("Cookie", "id=dsm-session")
		}
		rec := httptest.NewRecorder()
		CGIHandler(g).ServeHTTP(rec, req)
		return rec
	}
	good := "?op=cloud-thumbnail&node_id=42&revision=7"
	response := call(http.MethodGet, good, true)
	if response.Code != http.StatusOK ||
		!strings.Contains(response.Body.String(), `"content_type":"image/png"`) ||
		reader.reads != 1 {
		t.Fatalf("valid Server Owner thumbnail unavailable: %d %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "Bearer") ||
		strings.Contains(response.Body.String(), "storage_key") ||
		!strings.Contains(response.Body.String(), `"alpha_state":"opaque"`) {
		t.Fatal("private storage or invalid thumbnail projection reached DSM")
	}
	if reader.reads != 1 || native.runs != 0 || native.controls != 0 {
		t.Fatal("thumbnail triggered unrelated native backup actions")
	}
	for _, query := range []string{
		"?op=cloud-thumbnail",
		"?op=cloud-thumbnail&node_id=42",
		"?op=cloud-thumbnail&node_id=0&revision=7",
		"?op=cloud-thumbnail&node_id=042&revision=7",
		"?op=cloud-thumbnail&node_id=42&revision=07",
		"?op=cloud-thumbnail&node_id=42&revision=0",
		"?op=cloud-thumbnail&node_id=42&revision=7&url=https://remote.example",
		"?op=cloud-thumbnail&node_id=42&revision=7&node_id=99",
		"?op=cloud-thumbnail&node_id=42&revision=7;op=run",
	} {
		if invalid := call(http.MethodGet, query, true); invalid.Code == http.StatusOK {
			t.Fatalf("forged DSM thumbnail selector admitted: %s", query)
		}
	}
	for _, method := range []string{http.MethodHead, http.MethodPost, http.MethodPut, http.MethodDelete} {
		if invalid := call(method, good, true); invalid.Code == http.StatusOK {
			t.Fatalf("DSM thumbnail allowed unsafe method %s", method)
		}
	}
	if reader.reads != 1 {
		t.Fatal("invalid or unauthorized thumbnail selectors reached Agent")
	}
	if w := call(http.MethodGet, good, false); w.Code == http.StatusOK {
		t.Fatal("DSM thumbnail bypassed DSM session")
	}
	reader.bad = true
	if w := call(http.MethodGet, good, true); w.Code == http.StatusOK {
		t.Fatal("Agent's forged thumbnail reached DSM")
	}
	g.Authenticate = func(context.Context) (string, error) { return "other", nil }
	if w := call(http.MethodGet, good, true); w.Code != http.StatusForbidden {
		t.Fatal("different DSM principal read Owner thumbnail")
	}
}

func TestOldDSMOwnerAgentHasNoThumbnailCapability(t *testing.T) {
	g, native := newFixture(t)
	req := httptest.NewRequest(http.MethodGet,
		"https://nas.example:5001"+DSMCGIPath+"?op=cloud-thumbnail&node_id=42&revision=7", nil)
	req.Header.Set("Cookie", "id=dsm-session")
	rec := httptest.NewRecorder()
	CGIHandler(g).ServeHTTP(rec, req)
	if rec.Code != http.StatusNotImplemented || native.runs != 0 {
		t.Fatalf("old Agent pretended to serve Owner thumbnails: HTTP %d", rec.Code)
	}
}
