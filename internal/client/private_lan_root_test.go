package client

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/http"
	"strings"
	"testing"
	"time"
)

func privateRootFixture(t *testing.T, isCA bool, expired bool) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	notBefore, notAfter := now.Add(-time.Hour), now.Add(time.Hour)
	if expired {
		notBefore, notAfter = now.Add(-3*time.Hour), now.Add(-time.Hour)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(7),
		Subject:      pkix.Name{CommonName: "xdrive-private-test"},
		Issuer:       pkix.Name{CommonName: "xdrive-private-test"},
		NotBefore:    notBefore, NotAfter: notAfter,
		IsCA: isCA, BasicConstraintsValid: true,
		KeyUsage: x509.KeyUsageDigitalSignature,
	}
	if isCA {
		template.KeyUsage |= x509.KeyUsageCertSign
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}

func TestPrivateLANRootScopeAndIntegrity(t *testing.T) {
	root := privateRootFixture(t, true, false)
	const server = "https://192.168.2.4:8443"
	if err := ValidPrivateLANRoot(server, root); err != nil {
		t.Fatal(err)
	}
	for _, badURL := range []string{
		"http://192.168.2.4:8443", "https://example.com:8443",
		"https://192.168.2.4.evil.invalid", "https://8.8.8.8:8443",
		"https://127.0.0.1:8443", "https://192.168.2.4:8443/unexpected",
		"https://user:pass@192.168.2.4:8443", "https://[::1]:8443",
	} {
		if err := ValidPrivateLANRoot(badURL, root); err == nil {
			t.Fatalf("unexpected accepted URL %q", badURL)
		}
	}
	for _, badPEM := range []string{
		"", "not a cert", root + root, root + "hidden",
		privateRootFixture(t, false, false),
		privateRootFixture(t, true, true),
		strings.Repeat("A", 9000),
	} {
		if err := ValidPrivateLANRoot(server, badPEM); err == nil {
			t.Fatal("invalid root accepted")
		}
	}
}

func TestPrivateLANRootOnlyAffectsThisClientAndDoesNotDisableTLS(t *testing.T) {
	const origin = "https://192.168.2.4:8443"
	c := New(origin, "")
	other := New(origin, "")
	if err := c.ConfigurePrivateLANRoot(privateRootFixture(t, true, false)); err != nil {
		t.Fatal(err)
	}
	tr, ok := c.HTTP.Transport.(*http.Transport)
	if !ok || tr.TLSClientConfig == nil || tr.TLSClientConfig.RootCAs == nil {
		t.Fatal("scoped trust not configured")
	}
	if tr.Proxy != nil || tr.TLSClientConfig.InsecureSkipVerify ||
		tr.TLSClientConfig.MinVersion != tls.VersionTLS12 {
		t.Fatal("private LAN transport weakened TLS or allowed proxy")
	}
	if other.HTTP.Transport != nil {
		t.Fatal("unrelated client was modified")
	}
	if c.HTTP.CheckRedirect == nil {
		t.Fatal("redirect could escape the trust boundary")
	}
	if err := c.ConfigurePrivateLANRoot("untrusted PEM"); err == nil {
		t.Fatal("invalid trust accepted")
	}
}
