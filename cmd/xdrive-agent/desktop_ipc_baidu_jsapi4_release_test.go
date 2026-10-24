package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type baiduJSAPI4ReleaseIPCStub struct {
	desktopIPCController
	calls   int
	release client.MediaBaiduJSAPI4Release
}

func (s *baiduJSAPI4ReleaseIPCStub) CloudMediaBaiduJSAPI4Release(ctx context.Context) (client.MediaBaiduJSAPI4Release, error) {
	s.calls++
	if err := ctx.Err(); err != nil {
		return client.MediaBaiduJSAPI4Release{}, err
	}
	return s.release, nil
}

func TestDesktopBaiduJSAPI4ReleaseLoopbackOwnerBoundary(t *testing.T) {
	stub := &baiduJSAPI4ReleaseIPCStub{release: client.MediaBaiduJSAPI4Release{
		Provider: "baidu-jsapi-4.0", Enabled: true, ActivationState: "authorized_signed_release",
		Attribution: "© 百度地图", IsolatedChildOrigin: "https://map-isolated.example.org",
	}}
	h := newDesktopIPCHandler(stub, "opaque-agent-token", nil)
	path := "/v1/media/places/baidu-jsapi4-release"
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
			t.Fatalf("release HTTP %d expected %d: %s", w.Code, want, w.Body.String())
		}
		if w.Code == http.StatusOK {
			for _, private := range []string{"owner_id", "asset_id", "latitude", "longitude", "browser_ak", "jwt", "cookie", "token"} {
				if strings.Contains(strings.ToLower(w.Body.String()), private) {
					t.Fatalf("private field in release: %s", w.Body.String())
				}
			}
		}
		return w
	}
	const local = "127.0.0.1:31415"
	request(path, "", local, nil, http.StatusUnauthorized)
	request(path, "wrong", local, nil, http.StatusUnauthorized)
	request(path, "opaque-agent-token", "192.0.2.4:31415", nil, http.StatusForbidden)
	request(path+"?owner_id=5", "opaque-agent-token", local, nil, http.StatusBadRequest)
	request(path+"?latitude=35", "opaque-agent-token", local, nil, http.StatusBadRequest)
	if stub.calls != 0 {
		t.Fatal("untrusted request reached Server")
	}
	w := request(path, "opaque-agent-token", local, nil, http.StatusOK)
	if !strings.Contains(w.Header().Get("Cache-Control"), "no-store") ||
		!strings.Contains(w.Body.String(), "\"isolated_child_origin\":\"https://map-isolated.example.org\"") {
		t.Fatalf("signed Owner release missing: %s", w.Body.String())
	}
	stub.release.Enabled = false
	request(path, "opaque-agent-token", local, nil, http.StatusBadGateway)
	if stub.calls != 2 {
		t.Fatalf("unexpected signed map cloud calls: %d", stub.calls)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request(path, "opaque-agent-token", local, ctx, http.StatusBadRequest)
}
