package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type desktopMapGrantIPCStub struct {
	desktopIPCController
	calls int
	grant client.DesktopMapGuestGrant
}

func (s *desktopMapGrantIPCStub) CloudIssueDesktopMapGuestGrant(ctx context.Context) (client.DesktopMapGuestGrant, error) {
	s.calls++
	if err := ctx.Err(); err != nil {
		return client.DesktopMapGuestGrant{}, err
	}
	return s.grant, nil
}

func TestDesktopMapGrantIPCFailsClosedWithoutLoopbackOwnerAndExactRequest(t *testing.T) {
	s := &desktopMapGrantIPCStub{grant: client.DesktopMapGuestGrant{
		Ticket: strings.Repeat("a", 64), Username: "owner", ExpiresIn: 30,
	}}
	h := newDesktopIPCHandler(s, "local-desktop-ipc-token", nil)
	const endpoint = "/v1/cloud/desktop-map-grant"
	request := func(token, remote, path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.RemoteAddr = remote
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("status=%d want=%d: %s", w.Code, want, w.Body.String())
		}
		return w
	}
	const localhost = "127.0.0.1:36564"
	request("", localhost, endpoint, "", http.StatusUnauthorized)
	request("bad", localhost, endpoint, "", http.StatusUnauthorized)
	request("local-desktop-ipc-token", "192.0.2.9:3000", endpoint, "", http.StatusForbidden)
	request("local-desktop-ipc-token", localhost, endpoint+"?owner=other", "", http.StatusForbidden)
	request("local-desktop-ipc-token", localhost, endpoint, `{"token":"stolen"}`, http.StatusForbidden)
	if s.calls != 0 {
		t.Fatal("untrusted Renderer/remote request reached native Agent")
	}
	w := request("local-desktop-ipc-token", localhost, endpoint, "", http.StatusOK)
	if s.calls != 1 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("native map grant was not gated and returned without cache policy")
	}
	var received client.DesktopMapGuestGrant
	if json.Unmarshal(w.Body.Bytes(), &received) != nil || received != s.grant {
		t.Fatal("Desktop Main IPC receipt differed from native Server grant")
	}
	for _, secret := range []string{"native_refresh_token", "access_token", "password", "root_pem"} {
		if strings.Contains(w.Body.String(), secret) {
			t.Fatal("native Agent leaked long-lived credential to Main")
		}
	}
	s.grant.Ticket = strings.Repeat("G", 64)
	request("local-desktop-ipc-token", localhost, endpoint, "", http.StatusBadGateway)
	s.grant.Ticket = strings.Repeat("a", 64)
	s.grant.Username = ""
	request("local-desktop-ipc-token", localhost, endpoint, "", http.StatusBadGateway)
}

func TestDesktopMapGrantIPCUnavailableInBackupOnlyAgent(t *testing.T) {
	stub := &desktopMapGrantIPCStub{grant: client.DesktopMapGuestGrant{
		Ticket: strings.Repeat("a", 64), Username: "owner", ExpiresIn: 30,
	}}
	h := newDesktopIPCHandler(stub, "local-desktop-ipc-token", nil, true)
	req := httptest.NewRequest(http.MethodPost, "/v1/cloud/desktop-map-grant", nil)
	req.RemoteAddr = "127.0.0.1:36564"
	req.Header.Set("Authorization", "Bearer local-desktop-ipc-token")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code == http.StatusOK || stub.calls != 0 {
		t.Fatal("backup-only Agent minted browser map grant")
	}
}
