package synologyui

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeServerLoginAgent struct {
	*fakeAgent
	loginCalls int
	quotaCalls int
}

func (f *fakeServerLoginAgent) ServerConnection(context.Context) (localbackupipc.ServerConnection, error) {
	return localbackupipc.ServerConnection{
		Configured: true, Server: "https://drive.example.com", Username: "owner",
	}, nil
}

func (f *fakeServerLoginAgent) LoginServer(_ context.Context, server, username, password string) error {
	f.loginCalls++
	if server != "https://drive.example.com" || username != "owner" || password != "private-password" {
		return context.Canceled
	}
	return nil
}

func (f *fakeServerLoginAgent) OwnerQuota(context.Context) (localbackupipc.OwnerQuota, error) {
	f.quotaCalls++
	return localbackupipc.OwnerQuota{}, nil
}

func requestServerLogin(g *Gateway, method, payload, origin, token, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "https://nas.example:5001"+path, strings.NewReader(payload))
	req.Header.Set("Cookie", "id=dsm-session")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if token != "" {
		req.Header.Set("X-CSRF-Token", token)
	}
	req.Header.Set("Content-Type", "application/json")
	result := httptest.NewRecorder()
	CGIHandler(g).ServeHTTP(result, req)
	return result
}

func TestServerLoginCGIRequiresDSMOwnerCSRFAndExactCredentialSchema(t *testing.T) {
	g, backing := newFixture(t)
	agent := &fakeServerLoginAgent{fakeAgent: backing}
	g.Connect = func(context.Context) (Agent, error) { return agent, nil }
	csrf := getCSRF(t, g)
	body := `{"server":"https://drive.example.com","username":"owner","password":"private-password"}`
	p := DSMCGIPath + "?op=server-login"
	ok := requestServerLogin(g, "POST", body, "https://nas.example:5001", csrf, p)
	if ok.Code != http.StatusOK || agent.loginCalls != 1 || agent.quotaCalls != 1 {
		t.Fatalf("authenticated same-Owner login failed: HTTP %d (%s)", ok.Code, ok.Body.String())
	}
	var reply map[string]any
	if err := json.Unmarshal(ok.Body.Bytes(), &reply); err != nil || len(reply) != 1 || reply["verified"] != true {
		t.Fatal("DSM login must return only an Owner verification flag")
	}
	if strings.Contains(ok.Body.String(), "private-password") || strings.Contains(ok.Body.String(), "drive.example.com") {
		t.Fatal("DSM login response included secret or Server login data")
	}
	for _, tc := range []struct {
		name, method, body, origin, token, path string
	}{
		{"csrf missing", "POST", body, "https://nas.example:5001", "", p},
		{"cross origin", "POST", body, "https://foreign.example", csrf, p},
		{"wrong method", "GET", "", "", "", p},
		{"direct route bypass", "POST", body, "https://nas.example:5001", csrf, "/v1/server-login"},
		{"extra query", "POST", body, "https://nas.example:5001", csrf, p + "&path=/etc"},
		{"duplicate server", "POST", `{"server":"https://drive.example.com","server":"https://evil.example","username":"owner","password":"private-password"}`, "https://nas.example:5001", csrf, p},
		{"arbitrary mount", "POST", `{"server":"https://drive.example.com","username":"owner","password":"private-password","mount_path":"/volume1/photo"}`, "https://nas.example:5001", csrf, p},
		{"arbitrary trust root", "POST", `{"server":"https://drive.example.com","username":"owner","password":"private-password","trusted_lan_root_pem":"bad"}`, "https://nas.example:5001", csrf, p},
		{"no password", "POST", `{"server":"https://drive.example.com","username":"owner"}`, "https://nas.example:5001", csrf, p},
		{"trailing JSON", "POST", body + "{}", "https://nas.example:5001", csrf, p},
	} {
		t.Run(tc.name, func(t *testing.T) {
			previous := agent.loginCalls
			r := requestServerLogin(g, tc.method, tc.body, tc.origin, tc.token, tc.path)
			if r.Code == http.StatusOK || agent.loginCalls != previous {
				t.Fatalf("invalid login reached owning Agent: HTTP %d", r.Code)
			}
		})
	}
	// GET is a separate non-secret status route; a configured status never
	// leaks the Agent's password or a Root authorization.
	state := requestServerLogin(g, "GET", "", "", "", DSMCGIPath+"?op=server-connection")
	if state.Code != 200 {
		t.Fatalf("connection status HTTP %d", state.Code)
	}
}

func TestServerLoginNoCapabilityFailClosed(t *testing.T) {
	g, _ := newFixture(t)
	token := getCSRF(t, g)
	payload := `{"server":"https://drive.example.com","username":"owner","password":"private-password"}`
	r := requestServerLogin(g, "POST", payload, "https://nas.example:5001", token,
		DSMCGIPath+"?op=server-login")
	if r.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent must not claim new login, got %d", r.Code)
	}
}
