package localbackupipc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServerLoginTargetValidation(t *testing.T) {
	for _, server := range []string{
		"https://drive.example.com", "https://192.168.1.2:8443",
		"https://[::1]:8443/",
	} {
		if !validDSMLoginServer(server) {
			t.Fatalf("valid Server address rejected: %s", server)
		}
	}
	for _, server := range []string{
		"", "http://drive.example.com", "https://user:password@drive.example.com",
		"https://drive.example.com/api", "https://drive.example.com/?token=x",
		"https://drive.example.com/#secret", "https://drive.example.com\n",
	} {
		if validDSMLoginServer(server) {
			t.Fatalf("unsafe Server address accepted: %q", server)
		}
	}
	if !sameDSMLoginServer("https://DRIVE.example.com", "https://drive.example.com:443/") ||
		sameDSMLoginServer("https://drive.example.com:8443", "https://drive.example.com:443") {
		t.Fatal("incorrect same-origin Server login comparison")
	}
}

func TestServerLoginUsesOnlyExistingOwningAgentAuthAndRejectsOwnerSwitch(t *testing.T) {
	var loginCalls int
	var posted map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			t.Error("loopback Agent bearer missing")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/status":
			_, _ = w.Write([]byte(`{"configured":true,"server":"https://drive.example.com","username":"owner","must_change_password":false}`))
		case "/v1/auth/login":
			loginCalls++
			if r.Method != http.MethodPost {
				t.Error("Agent login must be POST")
			}
			if err := json.NewDecoder(r.Body).Decode(&posted); err != nil {
				t.Error(err)
				return
			}
			_, _ = w.Write([]byte(`{"configured":true,"server":"https://drive.example.com","username":"owner","must_change_password":false}`))
		default:
			t.Errorf("unexpected Agent path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	c := &Client{
		baseURL: server.URL, token: strings.Repeat("a", 64),
		capabilities: []string{"auth"}, http: server.Client(),
	}
	ctx := context.Background()
	if err := c.LoginServer(ctx, "https://different.example.com", "owner", "secret"); err == nil {
		t.Fatal("cross-Server migration must fail without changing Agent session")
	}
	if err := c.LoginServer(ctx, "https://drive.example.com", "foreign", "secret"); err == nil {
		t.Fatal("cross-Owner migration must fail without changing Agent session")
	}
	if loginCalls != 0 {
		t.Fatal("disallowed migration contacted the Agent login endpoint")
	}
	if err := c.LoginServer(ctx, "https://drive.example.com", "owner", "private-password"); err != nil {
		t.Fatal(err)
	}
	if loginCalls != 1 || posted["password"] != "private-password" ||
		posted["mount_path"] != "" || posted["server"] != "https://drive.example.com" {
		t.Fatal("typed Agent login did not preserve the bounded credential contract")
	}
	if _, exists := posted["trusted_lan_root_pem"]; exists {
		t.Fatal("DSM login cannot supply unapproved TLS trust roots")
	}
}

func TestServerLoginRejectsAgentWithoutCapability(t *testing.T) {
	c := &Client{}
	_, err := c.ServerConnection(context.Background())
	if err == nil || !strings.Contains(err.Error(), "does not support") {
		t.Fatal("unadvertised Agent login must fail closed")
	}
}
