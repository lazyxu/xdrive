package api

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"strings"
	"testing"
	"time"
)

func caddyTestRoot(t *testing.T, isCA bool, notAfter time.Time) (*x509.Certificate, []byte) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(24),
		Subject:      pkix.Name{CommonName: "xDrive test root"},
		NotBefore:    time.Now().Add(-24 * time.Hour),
		NotAfter:     notAfter, IsCA: isCA, BasicConstraintsValid: true,
		KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	if !isCA {
		template.KeyUsage = x509.KeyUsageDigitalSignature
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

func TestCaddyCertificatePublicRootOnlyAndNoTrustShortcuts(t *testing.T) {
	now := time.Now()
	valid, raw := caddyTestRoot(t, true, now.Add(24*time.Hour))
	got, normalized, err := caddyVerifiedPublicCARoot(raw, now)
	if err != nil || got == nil || got.SerialNumber.Cmp(valid.SerialNumber) != 0 || normalized != string(raw) {
		t.Fatalf("valid public CA rejected: %v", err)
	}
	cases := [][]byte{
		nil,
		[]byte("not a certificate"),
		append(bytes.Clone(raw), raw...),
		append(bytes.Clone(raw), []byte("\nextra")...),
		append(bytes.Clone(raw), []byte("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----")...),
		bytes.Repeat([]byte("x"), 8193),
	}
	_, notCA := caddyTestRoot(t, false, now.Add(time.Hour))
	_, expired := caddyTestRoot(t, true, now.Add(-time.Minute))
	cases = append(cases, notCA, expired)
	for index, input := range cases {
		if _, _, err := caddyVerifiedPublicCARoot(input, now); err == nil {
			t.Fatalf("untrusted root case %d accepted", index)
		}
	}
}

func TestCaddyPresentedCertificateMetadataIsBounded(t *testing.T) {
	cert, _ := caddyTestRoot(t, true, time.Now().Add(24*time.Hour))
	cert.DNSNames = []string{"drive.example.com"}
	cert.IPAddresses = []net.IP{net.ParseIP("192.168.2.4")}
	out := caddyCertificateDetails(cert)
	if out.State != "verified-local" || out.Issuer != "xDrive test root" ||
		out.DNSNames[0] != "drive.example.com" || out.IPAddresses[0] != "192.168.2.4" ||
		out.LeafSHA256 != caddyCertificateSHA256(cert.Raw) ||
		!strings.HasPrefix(out.LeafPEM, "-----BEGIN CERTIFICATE-----") {
		t.Fatalf("unexpected certificate metadata: %#v", out)
	}
	if _, err := time.Parse(time.RFC3339, out.NotAfter); err != nil {
		t.Fatalf("malformed expiry: %v", err)
	}
}

func TestCaddyCertificateInventoryRequiresTrustedHostObservation(t *testing.T) {
	s := &Server{}
	snap := caddyHostEnvSnapshot{Domain: "drive.example.com", DomainEnabled: true,
		LANIP: "192.168.2.4", LANEnabled: true}
	for _, host := range []caddyHostStatus{
		{State: "unhealthy", HTTPSConfigured: true, TLSState: "verified", LANHTTPSConfigured: true, LANTLSState: "verified"},
		{State: "healthy", HTTPSConfigured: false, TLSState: "verified", LANHTTPSConfigured: false, LANTLSState: "verified"},
	} {
		out := s.caddyCertificateInventory(context.Background(), snap, host, true)
		if out.Domain.State != "unverified" || out.LAN.State != "unverified" ||
			out.RootCA != nil || out.Domain.LeafPEM != "" || out.LAN.LeafPEM != "" {
			t.Fatalf("unverified Host produced downloadable material: %#v", out)
		}
	}
	out := s.caddyCertificateInventory(context.Background(), snap, caddyHostStatus{State: "healthy"}, false)
	if out.Domain.State != "unverified" || out.LAN.State != "unverified" {
		t.Fatal("missing Host observation was promoted")
	}
	snap.PendingRedeploy = true
	out = s.caddyCertificateInventory(context.Background(), snap, caddyHostStatus{State: "healthy"}, true)
	if out.RootCA != nil || out.LAN.State == "verified-local" {
		t.Fatal("saved-but-not-deployed intent was treated as certificate proof")
	}
}
