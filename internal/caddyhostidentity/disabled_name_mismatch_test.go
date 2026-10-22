package caddyhostidentity

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func startOnlyEnabledTLS(t *testing.T) (*httptest.Server, *x509.CertPool) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	root := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test CA"}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature}
	rootRaw, err := x509.CreateCertificate(rand.Reader, root, root, priv.Public(), priv)
	if err != nil {
		t.Fatal(err)
	}
	ca, err := x509.ParseCertificate(rootRaw)
	if err != nil {
		t.Fatal(err)
	}
	sk, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), NotBefore: now.Add(-time.Minute), NotAfter: now.Add(time.Hour), DNSNames: []string{"enabled.example.test"}, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, leaf, ca, sk.Public(), priv)
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
	s.TLS = &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{{Certificate: [][]byte{der, rootRaw}, PrivateKey: sk}}}
	s.StartTLS()
	t.Cleanup(s.Close)
	roots := x509.NewCertPool()
	roots.AddCert(ca)
	return s, roots
}

func TestOnlyActualTrustedWrongHostnameObserved(t *testing.T) {
	s, roots := startOnlyEnabledTLS(t)
	mismatched, err := privateProbeTLSNameMismatchAt(context.Background(), "disabled.example.test", roots, s.Listener.Addr().String())
	if err != nil || len(mismatched.digest) != 64 {
		t.Fatalf("trusted mismatch not observed: %v", err)
	}
	raw, err := json.Marshal(mismatched)
	if err != nil || string(raw) != "{}" {
		t.Fatal("private observation leaked into JSON")
	}
	for _, check := range []struct {
		name     string
		identity string
		roots    *x509.CertPool
		addr     string
	}{
		{"active served", "enabled.example.test", roots, s.Listener.Addr().String()},
		{"untrusted CA", "disabled.example.test", x509.NewCertPool(), s.Listener.Addr().String()},
		{"transport refused", "disabled.example.test", roots, "127.0.0.1:1"},
		{"invalid input", "https://disabled.example.test", roots, s.Listener.Addr().String()},
	} {
		t.Run(check.name, func(t *testing.T) {
			v, e := privateProbeTLSNameMismatchAt(context.Background(), check.identity, check.roots, check.addr)
			if e == nil || v != (privateTLSNameMismatchOnly{}) {
				t.Fatal("invalid negative input promoted to proof")
			}
		})
	}
	c, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := privateProbeTLSNameMismatchAt(c, "disabled.example.test", roots, s.Listener.Addr().String()); err == nil {
		t.Fatal("cancelled connection was accepted")
	}
}

func TestDisabledLANRequiresTrueHostOwnershipAndOperatorCA(t *testing.T) {
	for _, tt := range []struct {
		ip    string
		roots *x509.CertPool
	}{
		{"192.168.2.4", nil}, {"8.8.8.8", x509.NewCertPool()},
		{"192.168.2.4", x509.NewCertPool()},
	} {
		if _, err := privateProbeDisabledLANNameMismatch(context.Background(), tt.ip, tt.roots); err == nil {
			t.Fatal("invalid LAN negative observer admitted")
		}
	}
	if _, err := privateProbeDisabledDomainNameMismatch(context.Background(), strings.Repeat("X", 200)); err == nil {
		t.Fatal("invalid domain admitted")
	}
}
