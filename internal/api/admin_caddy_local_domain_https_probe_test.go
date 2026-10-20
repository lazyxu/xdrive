package api

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func testCaddyPublicDomainTLSFixture(t *testing.T) (*httptest.Server, *x509.CertPool, *sync.Mutex, *int, *string) {
	t.Helper()
	newKey := func() *ecdsa.PrivateKey {
		t.Helper()
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		return key
	}
	caKey := newKey()
	now := time.Now()
	caTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "xDrive test-only CA"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour),
		KeyUsage: x509.KeyUsageCertSign, IsCA: true, BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}
	rootPool := x509.NewCertPool()
	rootPool.AddCert(caCert)
	leafKey := newKey()
	leafTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "gateway.example.test"},
		DNSNames:  []string{"gateway.example.test"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTemplate, caCert, &leafKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	status := http.StatusOK
	body := `{"ok":true,"database":"ok","storage":"ok"}`
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/readyz" ||
			r.Host != "gateway.example.test" || r.Header.Get("Authorization") != "" ||
			r.Header.Get("Cookie") != "" || r.Header.Get("Proxy-Authorization") != "" {
			t.Errorf("unexpected TLS probe headers, method or route: %s %s %q", r.Method, r.URL.Path, r.Host)
		}
		mu.Lock()
		responseStatus, responseBody := status, body
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if responseStatus == http.StatusFound {
			w.Header().Set("Location", "https://attacker.invalid/collect")
		}
		w.WriteHeader(responseStatus)
		_, _ = w.Write([]byte(responseBody))
	}))
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{{
		Certificate: [][]byte{leafDER, caDER}, PrivateKey: leafKey,
	}}}
	srv.StartTLS()
	return srv, rootPool, &mu, &status, &body
}

func TestCaddyLocalDomainHTTPSFixedTLSValidatesTrustHostnameAndReady(t *testing.T) {
	srv, roots, mu, status, body := testCaddyPublicDomainTLSFixture(t)
	defer srv.Close()
	attempts := 0
	dial := func(ctx context.Context, network, address string) (net.Conn, error) {
		if network != "tcp" || address != caddyLocalDomainHTTPSDialAddress {
			t.Fatalf("TLS dial escaped fixed Docker Caddy: %s/%s", network, address)
		}
		attempts++
		return (&net.Dialer{}).DialContext(ctx, network, srv.Listener.Addr().String())
	}
	ctx := context.Background()
	t.Setenv("HTTPS_PROXY", "http://attacker.invalid:8811")
	t.Setenv("https_proxy", "http://attacker.invalid:8811")
	if !caddyLocalDomainHTTPSReady(ctx, "gateway.example.test", dial, roots) {
		t.Fatal("valid public CA, SNI, hostname, and ready JSON must verify")
	}
	if caddyLocalDomainHTTPSReady(ctx, "other.example.test", dial, roots) {
		t.Fatal("wrong SAN accepted")
	}
	if caddyLocalDomainHTTPSReady(ctx, "gateway.example.test", dial, x509.NewCertPool()) {
		t.Fatal("untrusted certificate accepted")
	}
	for _, invalid := range []string{"", "127.0.0.1", "https://gateway.example.test", "a.example.test:443", "foo/bar", "*"} {
		before := attempts
		if caddyLocalDomainHTTPSReady(ctx, invalid, dial, roots) || before != attempts {
			t.Fatalf("invalid domain triggered TLS network access: %q", invalid)
		}
	}
	mu.Lock()
	*status = http.StatusFound
	mu.Unlock()
	if caddyLocalDomainHTTPSReady(ctx, "gateway.example.test", dial, roots) {
		t.Fatal("redirect accepted")
	}
	mu.Lock()
	*status = http.StatusOK
	*body = "<html>SPA fallback</html>"
	mu.Unlock()
	if caddyLocalDomainHTTPSReady(ctx, "gateway.example.test", dial, roots) {
		t.Fatal("SPA fallback accepted")
	}
	mu.Lock()
	*body = strings.Repeat("X", caddyInternalRouteResponseLimit+1)
	mu.Unlock()
	if caddyLocalDomainHTTPSReady(ctx, "gateway.example.test", dial, roots) {
		t.Fatal("oversized body accepted")
	}
	mu.Lock()
	*body = `{"ok":true,"database":"failed","storage":"ok"}`
	mu.Unlock()
	if caddyLocalDomainHTTPSReady(ctx, "gateway.example.test", dial, roots) {
		t.Fatal("unhealthy Ready JSON accepted")
	}
	cancelCtx, cancel := context.WithCancel(ctx)
	cancel()
	if caddyLocalDomainHTTPSReady(cancelCtx, "gateway.example.test", dial, roots) ||
		caddyLocalDomainHTTPSReady(ctx, "gateway.example.test", nil, roots) {
		t.Fatal("canceled or missing route must fail closed")
	}
}
