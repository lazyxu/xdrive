package caddyhostidentity

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
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func startSyntheticHostHTTPS(t *testing.T, handler http.Handler) (*httptest.Server, *x509.CertPool) {
	t.Helper()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	caTemplate := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "synthetic-local-test-CA"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), BasicConstraintsValid: true, IsCA: true,
		KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, caKey.Public(), caKey)
	if err != nil {
		t.Fatal(err)
	}
	ca, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}
	serverKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	certTemplate := &x509.Certificate{SerialNumber: big.NewInt(2), NotBefore: now.Add(-time.Minute), NotAfter: now.Add(time.Hour),
		DNSNames: []string{"photos.example.test"}, IPAddresses: []net.IP{net.ParseIP("192.168.2.4")},
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, KeyUsage: x509.KeyUsageDigitalSignature}
	certDER, err := x509.CreateCertificate(rand.Reader, certTemplate, ca, serverKey.Public(), caKey)
	if err != nil {
		t.Fatal(err)
	}
	cert := tls.Certificate{Certificate: [][]byte{certDER, caDER}, PrivateKey: serverKey}
	srv := httptest.NewUnstartedServer(handler)
	srv.TLS = &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{cert}}
	srv.StartTLS()
	t.Cleanup(srv.Close)
	roots := x509.NewCertPool()
	roots.AddCert(ca)
	return srv, roots
}

func TestRealLocalTLSReadyAcceptsPinnedDomainAndPrivateIPSAN(t *testing.T) {
	server, roots := startSyntheticHostHTTPS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/readyz" ||
			r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("unsafe Ready request")
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_, _ = w.Write([]byte("{\"ok\":true}"))
	}))
	_, port, err := net.SplitHostPort(server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	for _, identity := range []string{"photos.example.test", "192.168.2.4"} {
		observed, err := probeBoundLocalTLSReady(context.Background(), identity, roots, server.Listener.Addr().String(), port)
		if err != nil {
			t.Fatalf("real trusted Ready observation failed for %s: %v", identity, err)
		}
		if len(observed.digest) != 64 || strings.Contains(observed.digest, identity) {
			t.Fatal("unexpected retained proof content")
		}
		if len(fmt.Sprintf("%+v", observed)) > 200 {
			t.Fatal("private observation serialization overlarge")
		}
	}
}

func TestRealLocalTLSReadyFailClosedOnBadCertCAAndHost(t *testing.T) {
	server, roots := startSyntheticHostHTTPS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"ok\":true}"))
	}))
	_, port, err := net.SplitHostPort(server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name, host string
		roots      *x509.CertPool
	}{
		{"wrong public hostname", "other.example.test", roots},
		{"wrong private IP SAN", "192.168.2.5", roots},
		{"wrong trust root", "photos.example.test", x509.NewCertPool()},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result, err := probeBoundLocalTLSReady(context.Background(), test.host, test.roots, server.Listener.Addr().String(), port)
			if err == nil || result.digest != "" {
				t.Fatal("untrusted local TLS admitted")
			}
		})
	}
}

func TestRealLocalTLSReadyNeverFollowsRedirectOrLargeBadJSON(t *testing.T) {
	for _, tc := range []struct {
		name        string
		status      int
		contentType string
		body        string
	}{
		{"redirect", 302, "application/json", "{\"ok\":true}"},
		{"false Ready", 200, "application/json", "{\"ok\":false}"},
		{"HTML Ready", 200, "text/html", "{\"ok\":true}"},
		{"oversized JSON", 200, "application/json", "{\"ok\":true,\"padding\":\"" + strings.Repeat("x", 1200) + "\"}"},
		{"trailing JSON", 200, "application/json", "{\"ok\":true}{\"ok\":true}"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var hit atomic.Int32
			server, roots := startSyntheticHostHTTPS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hit.Add(1)
				w.Header().Set("Content-Type", tc.contentType)
				if tc.status == 302 {
					w.Header().Set("Location", "https://malicious.example.test/ready")
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			_, port, err := net.SplitHostPort(server.Listener.Addr().String())
			if err != nil {
				t.Fatal(err)
			}
			result, err := probeBoundLocalTLSReady(context.Background(), "photos.example.test", roots, server.Listener.Addr().String(), port)
			if err == nil || result.digest != "" || hit.Load() != 1 {
				t.Fatalf("failed to reject bad Ready (hits=%d, err=%v)", hit.Load(), err)
			}
		})
	}
}

func TestRealLocalTLSReadyRespectsCancellationAndHostOwnership(t *testing.T) {
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := probeBoundLocalTLSReady(cancelled, "photos.example.test", x509.NewCertPool(), "127.0.0.1:8443", "8443"); err == nil {
		t.Fatal("cancelled Ready started")
	}
	for _, s := range []string{"169.254.10.3", "8.8.8.8", "127.0.0.1", "::1", "not-an-ip"} {
		if hostOwnsIP(s) {
			t.Fatalf("nonprivate/noncanonical IP admitted: %s", s)
		}
	}
	if _, err := probeCaddyLANReady(context.Background(), "192.168.2.4", nil); err == nil {
		t.Fatal("LAN without trusted local CA admitted")
	}
	if _, err := probeCaddyDomainReady(context.Background(), "https://photos.example.test"); err == nil {
		t.Fatal("noncanonical domain admitted")
	}
}

func TestRealLocalTLSReadyDoesNotRepresentAdminProof(t *testing.T) {
	srv, roots := startSyntheticHostHTTPS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"ok\":true}"))
	}))
	_, port, err := net.SplitHostPort(srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	proof, err := probeBoundLocalTLSReady(context.Background(), "photos.example.test", roots, srv.Listener.Addr().String(), port)
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(proof)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte("photos.example.test")) || bytes.Contains(data, []byte("192.168.2.4")) {
		t.Fatal("probed Host identity escaped JSON")
	}
	// This package-private proof has no CandidateComplete/CanAdopt/ApplySupported method.
}
