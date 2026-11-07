package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/userconfig"
)

func desktopMapLANTestCA(t *testing.T) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	cert := &x509.Certificate{
		SerialNumber: big.NewInt(101),
		Subject: pkix.Name{CommonName: "xDrive test-only private LAN CA"},
		NotBefore: now.Add(-time.Minute), NotAfter: now.Add(time.Hour),
		KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		IsCA: true, BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}

type desktopMapLANTrustIPCStub struct {
	desktopIPCController
	calls int
	receipt desktopMapLANTrustReceipt
}

func (s *desktopMapLANTrustIPCStub) CloudDesktopMapLANTrust(ctx context.Context) (desktopMapLANTrustReceipt, error) {
	s.calls++
	if err := ctx.Err(); err != nil {
		return desktopMapLANTrustReceipt{}, err
	}
	return s.receipt, nil
}

func TestDesktopMapLANTrustPublicCAOnlyLoopbackAndOwnerScoped(t *testing.T) {
	const origin = "https://192.168.2.4:8443"
	ca := desktopMapLANTestCA(t)
	stub := &desktopMapLANTrustIPCStub{receipt: desktopMapLANTrustReceipt{
		Available: true, Server: origin, Username: "owner", RootPEM: ca,
	}}
	h := newDesktopIPCHandler(stub, "local-agent-token", nil)
	request := func(token, remote, target, body string, headers map[string]string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, target, strings.NewReader(body))
		req.RemoteAddr = remote
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		for name, value := range headers {
			req.Header.Set(name, value)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("unexpected HTTP %d want %d", w.Code, want)
		}
		return w
	}
	const endpoint = "/v1/cloud/desktop-map-lan-trust"
	const local = "127.0.0.1:35678"
	request("", local, endpoint, "", nil, http.StatusUnauthorized)
	request("bad-token", local, endpoint, "", nil, http.StatusUnauthorized)
	request("local-agent-token", "192.0.2.5:35678", endpoint, "", nil, http.StatusForbidden)
	request("local-agent-token", local, endpoint+"?owner=foreign", "", nil, http.StatusForbidden)
	request("local-agent-token", local, endpoint, "invalid-body", nil, http.StatusForbidden)
	request("local-agent-token", local, endpoint, "", map[string]string{"Cookie":"private=1"}, http.StatusForbidden)
	request("local-agent-token", local, endpoint, "", map[string]string{"Origin":"https://evil.invalid"}, http.StatusForbidden)
	request("local-agent-token", local, endpoint, "", map[string]string{"Sec-Fetch-Site":"cross-site"}, http.StatusForbidden)
	if stub.calls != 0 {
		t.Fatal("untrusted request reached native public CA authority")
	}
	ok := request("local-agent-token", local, endpoint, "", nil, http.StatusOK)
	var got desktopMapLANTrustReceipt
	if json.Unmarshal(ok.Body.Bytes(), &got) != nil || got != stub.receipt {
		t.Fatal("native public CA was not Owner/Server-bound")
	}
	if ok.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("public CA receipt must not be cached by the browser")
	}
	for _, private := range []string{"access_token", "refresh_token", "password", "session_id", "connection_ip"} {
		if strings.Contains(ok.Body.String(), private) {
			t.Fatal("native CA response leaked private session data")
		}
	}
	stub.receipt = desktopMapLANTrustReceipt{Available: false}
	missing := request("local-agent-token", local, endpoint, "", nil, http.StatusOK)
	if strings.Contains(missing.Body.String(), "root_pem") {
		t.Fatal("unavailable native pin disclosed a certificate")
	}
	stub.receipt = desktopMapLANTrustReceipt{Available:true,Server: "https://example.invalid",Username:"owner",RootPEM:ca}
	request("local-agent-token", local, endpoint, "", nil, http.StatusBadGateway)
	stub.receipt = desktopMapLANTrustReceipt{Available:true,Server:origin,Username:"",RootPEM:ca}
	request("local-agent-token", local, endpoint, "", nil, http.StatusBadGateway)

	backup := newDesktopIPCHandler(stub, "local-agent-token", nil, true)
	req := httptest.NewRequest(http.MethodGet, endpoint, nil)
	req.RemoteAddr = local
	req.Header.Set("Authorization", "Bearer local-agent-token")
	deny := httptest.NewRecorder()
	backup.ServeHTTP(deny, req)
	if deny.Code == http.StatusOK {
		t.Fatal("backup-only Agent exposed native Owner LAN trust")
	}
}

func TestDesktopMapLANTrustControllerRequiresMatchingLoggedInOwnerAndConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", home)
	t.Setenv("APPDATA", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	const origin = "https://192.168.2.4:8443"
	ca := desktopMapLANTestCA(t)
	cfg := userconfig.Config{Server: origin, Username: "owner",
		SessionID: "test-map-lan-current-session", TrustedLANRootPEM: ca}
	if err := userconfig.Save(cfg); err != nil {
		t.Fatal(err)
	}
	ctrl := &agentController{snap: agentSnapshot{
		Configured: true, Username: "owner", Server: origin,
		AuthStatus: "已登录",
	}}
	got, err := ctrl.CloudDesktopMapLANTrust(context.Background())
	if err != nil || !got.Available || got.RootPEM != ca ||
		got.Server != origin || got.Username != "owner" {
		t.Fatal("logged-in native Owner CA was not returned exactly")
	}
	ctrl.snap.Username = "another-owner"
	if _, err := ctrl.CloudDesktopMapLANTrust(context.Background()); err == nil {
		t.Fatal("native Owner mismatch exposed old CA")
	}
	ctrl.snap.Username = "owner"
	ctrl.snap.AuthStatus = "登录已过期"
	if _, err := ctrl.CloudDesktopMapLANTrust(context.Background()); err == nil {
		t.Fatal("expired native Agent exposed old CA")
	}
	ctrl.snap.AuthStatus = "已登录"
	ctrl.snap.ConnectionIP = "192.168.2.5"
	if _, err := ctrl.CloudDesktopMapLANTrust(context.Background()); err == nil {
		t.Fatal("changed native selected connection IP reused stale CA")
	}
	ctrl.snap.ConnectionIP = ""
	cfg.TrustedLANRootPEM = ""
	if err := userconfig.Save(cfg); err != nil {
		t.Fatal(err)
	}
	got, err = ctrl.CloudDesktopMapLANTrust(context.Background())
	if err != nil || got.Available || got.RootPEM != "" {
		t.Fatal("system-CA native login should not expose a private root")
	}
}
