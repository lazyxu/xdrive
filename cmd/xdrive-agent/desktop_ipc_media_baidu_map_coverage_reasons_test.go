package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type baiduCoverageReasonsIPCStub struct {
	desktopIPCController
	calls int
	value client.MediaBaiduMapCoverageReasons
}

func (s *baiduCoverageReasonsIPCStub) CloudMediaBaiduMapCoverageReasons(ctx context.Context) (client.MediaBaiduMapCoverageReasons, error) {
	s.calls++
	if err := ctx.Err(); err != nil {
		return client.MediaBaiduMapCoverageReasons{}, err
	}
	return s.value, nil
}

func TestDesktopBaiduCoverageReasonsLoopbackOwnerBoundary(t *testing.T) {
	stub := &baiduCoverageReasonsIPCStub{}
	stub.value.Scope = "indexed_ready_photoassets"
	stub.value.ValidGPSAssets = 8
	stub.value.EligibleBD09Assets = 1
	stub.value.NotEligibleBD09Assets = 7
	stub.value.ConsentUnavailableAssets = 3
	stub.value.ConsentSourceChangedAssets = 1
	stub.value.DerivedMissingAssets = 1
	stub.value.DerivedInvalidAssets = 2
	h := newDesktopIPCHandler(stub, "opaque-agent-token", nil)
	path := "/v1/media/places/baidu-coverage-reasons"
	request := func(uri, token, remote string, ctx context.Context, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, uri, nil)
		req.RemoteAddr = remote
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if ctx != nil {
			req = req.WithContext(ctx)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("GET %s: HTTP %d expected %d: %s", uri, w.Code, want, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "latitude") ||
			strings.Contains(w.Body.String(), "longitude") ||
			strings.Contains(w.Body.String(), "source_node") ||
			strings.Contains(w.Body.String(), "asset_id") ||
			strings.Contains(w.Body.String(), "owner_id") ||
			strings.Contains(w.Body.String(), "browser_ak") {
			t.Fatalf("private map identity leaked from Agent: %s", w.Body.String())
		}
		return w
	}
	const loopback = "127.0.0.1:31415"
	request(path, "", loopback, nil, http.StatusUnauthorized)
	request(path, "wrong-token", loopback, nil, http.StatusUnauthorized)
	request(path, "opaque-agent-token", "192.0.2.4:31415", nil, http.StatusForbidden)
	request(path+"?owner_id=77", "opaque-agent-token", loopback, nil, http.StatusBadRequest)
	request(path+"?latitude=35.1", "opaque-agent-token", loopback, nil, http.StatusBadRequest)
	if stub.calls != 0 {
		t.Fatalf("untrusted request reached cloud Controller %d times", stub.calls)
	}
	response := request(path, "opaque-agent-token", loopback, nil, http.StatusOK)
	if !strings.Contains(response.Header().Get("Cache-Control"), "no-store") ||
		!strings.Contains(response.Body.String(), "\"consent_unavailable_assets\":3") ||
		!strings.Contains(response.Body.String(), "\"derived_invalid_assets\":2") {
		t.Fatalf("missing trusted Owner-only response or cache policy: %s", response.Body.String())
	}
	stub.value.DerivedInvalidAssets++
	request(path, "opaque-agent-token", loopback, nil, http.StatusBadGateway)
	if stub.calls != 2 {
		t.Fatalf("Agent made unexpected cloud Controller calls: %d", stub.calls)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	response = request(path, "opaque-agent-token", loopback, ctx, http.StatusBadRequest)
	if response.Header().Get("Cache-Control") == "" {
		t.Fatal("failed Owner response was cacheable")
	}
}
