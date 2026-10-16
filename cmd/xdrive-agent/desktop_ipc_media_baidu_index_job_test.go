package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type baiduIndexJobIPCStub struct {
	desktopIPCController
	calls []string
}

func (s *baiduIndexJobIPCStub) CloudMediaBaiduIndexJob(_ context.Context, nodeID uint64) (client.MediaBaiduMapIndexJob, error) {
	s.calls = append(s.calls, "get")
	return client.MediaBaiduMapIndexJob{Status: "not_queued", ActivationState: "blocked_pending_licence_and_provider_review"}, nil
}

func (s *baiduIndexJobIPCStub) CloudEnqueueMediaBaiduIndexJob(_ context.Context, nodeID uint64, input client.MediaBaiduMapIndexJobInput) (client.MediaBaiduMapIndexJob, error) {
	s.calls = append(s.calls, "post")
	if nodeID != 42 || !input.Confirm || input.ExpectedRevision != 7 {
		return client.MediaBaiduMapIndexJob{}, context.Canceled
	}
	return client.MediaBaiduMapIndexJob{Status: "queued", ConsentRevision: input.ExpectedRevision, ActivationState: "blocked_pending_licence_and_provider_review"}, nil
}

func (s *baiduIndexJobIPCStub) CloudCancelMediaBaiduIndexJob(_ context.Context, nodeID, revision uint64) (client.MediaBaiduMapIndexJob, error) {
	s.calls = append(s.calls, "delete")
	if nodeID != 42 || revision != 7 {
		return client.MediaBaiduMapIndexJob{}, context.Canceled
	}
	return client.MediaBaiduMapIndexJob{Status: "cancelled", ConsentRevision: revision, ActivationState: "blocked_pending_licence_and_provider_review"}, nil
}

func TestDesktopBaiduIndexJobLoopbackContract(t *testing.T) {
	stub := &baiduIndexJobIPCStub{}
	h := newDesktopIPCHandler(stub, "opaque-agent-token", nil)
	hit := func(method, uri, body, token, remote string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, uri, strings.NewReader(body))
		req.RemoteAddr = remote
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if method == http.MethodPost {
			req.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: HTTP %d want %d: %s", method, uri, w.Code, want, w.Body.String())
		}
		for _, secret := range []string{"latitude", "longitude", "source_node", "lease_token", "BrowserAK", "BaiduMapAK"} {
			if strings.Contains(w.Body.String(), secret) {
				t.Fatalf("protected field leaked from Agent response: %s", secret)
			}
		}
		return w
	}
	const path = "/v1/media/baidu-index-job?node_id=42"
	const remote = "127.0.0.1:31415"
	// Middleware denies wrong token and non-loopback clients before any controller access.
	hit(http.MethodGet, path, "", "", remote, http.StatusUnauthorized)
	hit(http.MethodGet, path, "", "opaque-agent-token", "192.0.2.4:31415", http.StatusForbidden)
	hit(http.MethodGet, path, "", "opaque-agent-token", remote, http.StatusOK)
	hit(http.MethodPost, path, `{"expected_revision":7,"confirm":false}`, "opaque-agent-token", remote, http.StatusBadRequest)
	hit(http.MethodPost, path, `{"expected_revision":7,"confirm":true,"latitude":32}`, "opaque-agent-token", remote, http.StatusBadRequest)
	hit(http.MethodPost, "/v1/media/baidu-index-job?node_id=0", `{"expected_revision":7,"confirm":true}`, "opaque-agent-token", remote, http.StatusBadRequest)
	w := hit(http.MethodPost, path, `{"expected_revision":7,"confirm":true}`, "opaque-agent-token", remote, http.StatusAccepted)
	if !strings.Contains(w.Body.String(), `"status":"queued"`) {
		t.Fatalf("no sanitized queued receipt: %s", w.Body.String())
	}
	hit(http.MethodDelete, path+"&revision=7", `{"gps":32}`, "opaque-agent-token", remote, http.StatusBadRequest)
	hit(http.MethodDelete, path+"&revision=0", "", "opaque-agent-token", remote, http.StatusBadRequest)
	w = hit(http.MethodDelete, path+"&revision=7", "", "opaque-agent-token", remote, http.StatusOK)
	if !strings.Contains(w.Body.String(), `"status":"cancelled"`) {
		t.Fatalf("no sanitized cancel receipt: %s", w.Body.String())
	}
	if strings.Join(stub.calls, ",") != "get,post,delete" {
		t.Fatalf("unexpected Controller invocations: %v", stub.calls)
	}
}
