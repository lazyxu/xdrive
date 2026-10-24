package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

type connectionIPDesktopController struct {
	fakeDesktopIPCController
	connectionIP string
	rootPEM      string
	called       bool
}

func (c *connectionIPDesktopController) AuthenticateWithConnectionIP(server, username, password, mountPath, rootPEM, ip string) error {
	c.called = true
	c.connectionIP, c.rootPEM = ip, rootPEM
	return c.Authenticate(server, username, password, mountPath)
}

func TestDesktopIPCConnectionIPCombinesWithPrivateRootAndExplicitClear(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", ""} {
		ctrl := &connectionIPDesktopController{}
		h := newDesktopIPCHandler(ctrl, "secret", func() {})
		body, _ := json.Marshal(map[string]string{"server": "https://route.test", "username": "alice", "password": "fixture", "trusted_lan_root_pem": "fixture-root", "connection_ip": ip})
		res := desktopIPCRequest(t, h, http.MethodPost, "/v1/auth/login", string(body))
		if res.Code != http.StatusOK || !ctrl.called || ctrl.connectionIP != ip || ctrl.rootPEM != "fixture-root" || ctrl.loginUsername != "alice" {
			t.Fatalf("route was not delivered atomically with trust: status=%d body=%s called=%v", res.Code, res.Body.String(), ctrl.called)
		}
	}
}

func TestDesktopIPCConnectionIPUnsupportedNeverFallsBack(t *testing.T) {
	ctrl := &fakeDesktopIPCController{}
	res := desktopIPCRequest(t, newDesktopIPCHandler(ctrl, "secret", func() {}), http.MethodPost, "/v1/auth/login", `{"server":"https://route.test","username":"alice","password":"fixture","connection_ip":"127.0.0.1"}`)
	if res.Code != http.StatusNotImplemented || ctrl.loginServer != "" || !strings.Contains(res.Body.String(), "agent_connection_ip_unsupported") {
		t.Fatalf("unsafe legacy fallback: %d %s", res.Code, res.Body.String())
	}
}

func TestDesktopIPCStatusExposesOnlySessionConnectionIP(t *testing.T) {
	var snapshot agentSnapshot
	// JSON is only a fixture adapter here, keeping RED a behavioral assertion.
	_ = json.Unmarshal([]byte(`{"Server":"https://route.test","ConnectionIP":"127.0.0.1"}`), &snapshot)
	encoded, err := json.Marshal(makeDesktopIPCStatus(snapshot, 1))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(encoded, []byte(`"connection_ip":"127.0.0.1"`)) {
		t.Fatal("status did not expose selected session route")
	}
}

func TestDesktopAgentNeverDowngradesCorruptStoredConnectionIP(t *testing.T) {
	root := t.TempDir()
	for _, key := range []string{"APPDATA", "XDG_CONFIG_HOME", "HOME", "USERPROFILE"} {
		t.Setenv(key, root)
	}
	path, err := userconfig.Path()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"server":"https://route.test","session_id":"previous-login","username":"alice","connection_ip":"not-an-IP"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	ctrl := &agentController{ctx: context.Background()}
	err = ctrl.Authenticate("https://route.test", "alice", "fixture", "")
	if err == nil || !strings.Contains(err.Error(), "explicit reapproval") {
		t.Fatalf("invalid stored route silently downgraded: %v", err)
	}
}

func TestDesktopAgentConnectionIPPersistsAndLegacyLoginRetainsIt(t *testing.T) {
	root := t.TempDir()
	for _, key := range []string{"APPDATA", "XDG_CONFIG_HOME", "HOME", "USERPROFILE"} {
		t.Setenv(key, root)
	}
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ca := &x509.Certificate{SerialNumber: big.NewInt(91), Subject: pkix.Name{CommonName: "Agent fixture CA"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, &privateKey.PublicKey, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	ca, err = x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(92), IPAddresses: []net.IP{net.ParseIP("192.168.123.123")}, NotBefore: ca.NotBefore, NotAfter: ca.NotAfter, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	leafDER, err := x509.CreateCertificate(rand.Reader, leaf, ca, &privateKey.PublicKey, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	logins := 0
	ts := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/login":
			mu.Lock()
			logins++
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(client.AuthResponse{AccessToken: "fixture-access", Username: "alice", ExpiresIn: 900})
		case "/api/v1/version":
			_ = json.NewEncoder(w).Encode(client.VersionInfo{Version: "fixture"})
		case "/api/v1/nodes/root":
			if r.Header.Get("Authorization") != "Bearer fixture-access" {
				t.Error("background client lost credential")
			}
			_ = json.NewEncoder(w).Encode(client.Node{ID: 1, Type: "dir"})
		default:
			http.NotFound(w, r)
		}
	}))
	ts.TLS = &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{leafDER, caDER}, PrivateKey: privateKey}}}
	ts.StartTLS()
	defer ts.Close()
	const port = "443"
	origin := "https://192.168.123.123:443"
	rootPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}))
	// Every actual socket stays local; record the address selected by production
	// transport to distinguish retained routes from an explicit route clear.
	previousDefault := http.DefaultTransport
	fixtureTransport := previousDefault.(*http.Transport).Clone()
	var addresses []string
	fixtureTransport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		mu.Lock()
		addresses = append(addresses, address)
		mu.Unlock()
		return (&net.Dialer{}).DialContext(ctx, network, ts.Listener.Addr().String())
	}
	http.DefaultTransport = fixtureTransport
	t.Cleanup(func() { http.DefaultTransport = previousDefault; fixtureTransport.CloseIdleConnections() })
	ctx, cancel := context.WithCancel(context.Background())
	ctrl := newAgentController(ctx, cancel)
	t.Cleanup(func() { cancel(); <-ctrl.historyWriterDone })
	login, ok := any(ctrl).(interface {
		AuthenticateWithConnectionIP(string, string, string, string, string, string) error
	})
	if !ok {
		t.Fatal("Agent does not support explicit session routes")
	}
	if err := login.AuthenticateWithConnectionIP(origin, "alice", "fixture", filepath.Join(root, "mount"), rootPEM, "127.0.0.1"); err != nil {
		t.Fatal(err)
	}
	cfg, err := userconfig.Load()
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(cfg)
	if !bytes.Contains(data, []byte(`"connection_ip":"127.0.0.1"`)) {
		t.Fatal("login did not persist selected route")
	}
	background, err := userconfig.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer background.HTTP.CloseIdleConnections()
	if _, err = background.Root(ctx); err != nil {
		t.Fatalf("background route/root CA lost: %v", err)
	}
	if err = ctrl.Authenticate("https://192.168.123.123", "alice", "fixture", ""); err != nil {
		t.Fatalf("legacy login did not retain route/trust: %v", err)
	}
	if err = login.AuthenticateWithConnectionIP(origin, "alice", "fixture", "", rootPEM, ""); err != nil {
		t.Fatalf("explicit route clear failed: %v", err)
	}
	cfg, err = userconfig.Load()
	if err != nil {
		t.Fatal(err)
	}
	data, _ = json.Marshal(cfg)
	if bytes.Contains(data, []byte(`"connection_ip"`)) {
		t.Fatal("explicit empty route was not cleared")
	}
	if ctrl.Snapshot().ConnectionIP != "" {
		t.Fatal("status kept stale route after explicit clear")
	}
	mu.Lock()
	defer mu.Unlock()
	if logins != 3 {
		t.Fatalf("login count=%d, want exactly one per explicit login", logins)
	}
	if len(addresses) < 4 {
		t.Fatalf("missing TLS route observations: %v", addresses)
	}
	for _, address := range addresses[:len(addresses)-1] {
		if address != net.JoinHostPort("127.0.0.1", port) {
			t.Fatalf("stored route not retained: %v", addresses)
		}
	}
	if addresses[len(addresses)-1] != net.JoinHostPort("192.168.123.123", port) {
		t.Fatalf("explicit clear still used stale route: %v", addresses)
	}
}
