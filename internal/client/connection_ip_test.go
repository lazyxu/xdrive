package client

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func configureTestConnectionIP(t *testing.T, c *Client, ip string) error {
	t.Helper()
	configurer, ok := any(c).(interface{ ConfigureConnectionIP(string) error })
	if !ok {
		t.Fatal("Client does not support scoped connection IP")
	}
	return configurer.ConfigureConnectionIP(ip)
}

// Only route.test is certified: connecting by URL IP would fail hostname checks.
func connectionIPTLSFixture(t *testing.T, handler http.Handler) (*httptest.Server, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ca := &x509.Certificate{SerialNumber: big.NewInt(81), Subject: pkix.Name{CommonName: "route fixture CA"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	ca, err = x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(82), DNSNames: []string{"route.test"}, NotBefore: ca.NotBefore, NotAfter: ca.NotAfter, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	leafDER, err := x509.CreateCertificate(rand.Reader, leaf, ca, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewUnstartedServer(handler)
	s.Config.ErrorLog = log.New(io.Discard, "", 0)
	s.TLS = &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{leafDER, caDER}, PrivateKey: key}}}
	s.StartTLS()
	t.Cleanup(s.Close)
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}))
	return s, pool
}

func TestConnectionIPRetainsHostSNIAndScopedTrust(t *testing.T) {
	var calls atomic.Int32
	s, roots := connectionIPTLSFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if !strings.HasPrefix(r.Host, "route.test:") || r.TLS.ServerName != "route.test" {
			t.Errorf("lost HTTPS identity: Host=%q SNI=%q", r.Host, r.TLS.ServerName)
		}
		_, _ = w.Write([]byte(`{"access_token":"fixture","username":"alice"}`))
	}))
	_, port, _ := net.SplitHostPort(s.Listener.Addr().String())
	c := New("https://route.test:"+port, "")
	original := http.DefaultTransport.(*http.Transport).Clone()
	original.TLSClientConfig = &tls.Config{RootCAs: roots}
	original.Proxy = func(*http.Request) (*url.URL, error) {
		t.Error("pinned route used a proxy")
		return nil, errors.New("proxy forbidden")
	}
	c.HTTP.Transport = original
	if err := configureTestConnectionIP(t, c, "127.0.0.1"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := c.Login(ctx, "alice", "fixture-password"); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("HTTP calls=%d, want one login", calls.Load())
	}
	if original.TLSClientConfig.ServerName != "" {
		t.Fatal("shared source transport mutated")
	}
	c.HTTP.CloseIdleConnections()
}

func TestConnectionIPTLSRejectsBeforeCredentials(t *testing.T) {
	var calls atomic.Int32
	s, roots := connectionIPTLSFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	_, port, _ := net.SplitHostPort(s.Listener.Addr().String())
	for _, tc := range []struct {
		name, host string
		trusted    bool
	}{
		{"wrong-hostname", "wrong.test", true}, {"untrusted-CA", "route.test", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := New("https://"+tc.host+":"+port, "")
			tr := http.DefaultTransport.(*http.Transport).Clone()
			if tc.trusted {
				tr.TLSClientConfig = &tls.Config{RootCAs: roots}
			}
			c.HTTP.Transport = tr
			if err := configureTestConnectionIP(t, c, "127.0.0.1"); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_, err := c.Login(ctx, "alice", "fixture-password")
			if err == nil {
				t.Fatal("TLS verification accepted invalid server")
			}
			if tc.trusted {
				var mismatch x509.HostnameError
				if !errors.As(err, &mismatch) {
					t.Fatalf("not hostname error: %v", err)
				}
			} else {
				var untrusted x509.UnknownAuthorityError
				if !errors.As(err, &untrusted) {
					t.Fatalf("not CA error: %v", err)
				}
			}
			c.HTTP.CloseIdleConnections()
		})
	}
	if calls.Load() != 0 {
		t.Fatalf("credentials reached HTTP %d times", calls.Load())
	}
}

func TestConnectionIPRejectsRedirectAndForeignOriginReuse(t *testing.T) {
	var calls atomic.Int32
	s, roots := connectionIPTLSFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Location", "https://foreign.test/private")
		w.WriteHeader(http.StatusTemporaryRedirect)
	}))
	_, port, _ := net.SplitHostPort(s.Listener.Addr().String())
	c := New("https://route.test:"+port, "token")
	c.HTTP.Transport = &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots}}
	if err := configureTestConnectionIP(t, c, "127.0.0.1"); err != nil {
		t.Fatal(err)
	}
	defer c.HTTP.CloseIdleConnections()
	if _, err := c.Login(context.Background(), "alice", "fixture-password"); !errors.Is(err, ErrAuthRedirect) {
		t.Fatalf("redirect=%v", err)
	}
	for _, endpoint := range []string{"https://foreign.test:" + port, "https://route.test:1", "http://route.test:" + port} {
		req, _ := http.NewRequest(http.MethodGet, endpoint+"/private", nil)
		req.Header.Set("Authorization", "Bearer fixture")
		if resp, err := c.HTTP.Do(req); err == nil {
			resp.Body.Close()
			t.Fatalf("foreign origin accepted: %s", endpoint)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("redirect/reuse reached server: %d", calls.Load())
	}
}

func TestConnectionIPRejectsInvalidIPAndNonOrigin(t *testing.T) {
	for _, ip := range []string{"route.test", "127.0.0.1:443", " 127.0.0.1", "[::1]", "fe80::1%eth0", "127.0.0.1/8", "https://127.0.0.1"} {
		c := New("https://route.test", "")
		if err := configureTestConnectionIP(t, c, ip); err == nil {
			t.Fatalf("IP accepted: %q", ip)
		}
		if c.HTTP.Transport != nil {
			t.Fatal("invalid configuration mutated client")
		}
	}
	for _, origin := range []string{"http://route.test", "https://user@route.test", "https://route.test/path", "https://route.test?", "https://route.test#fragment", "https://route.test:0", "https://route.test:65536"} {
		if err := configureTestConnectionIP(t, New(origin, ""), "127.0.0.1"); err == nil {
			t.Fatalf("origin accepted: %q", origin)
		}
	}
	c := New("http://legacy.test", "")
	if err := configureTestConnectionIP(t, c, ""); err != nil || c.HTTP.Transport != nil {
		t.Fatal("empty setting changed legacy transport")
	}
}
