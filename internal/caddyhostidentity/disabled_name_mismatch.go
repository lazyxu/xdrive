package caddyhostidentity

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"net"
	"time"
)

// privateTLSNameMismatchOnly is deliberately a weak, HOST-PRIVATE indication:
// an independently trusted server responded with a certificate that does not
// authorize the requested SNI / IP identity. It DOES NOT prove that HTTP routes,
// authorization, an alternate Host header or external ingress are disabled.
// A mere failed connection, timeout, unknown CA or TLS alert is never evidence.
// No caller may turn this into a signed negative-ingress proof or Host Apply.
type privateTLSNameMismatchOnly struct{ digest string }

// privateProbeTLSNameMismatchAt is package-private so synthetic TLS listeners
// can be tested without changing the production fixed :8443 destination.
// TLS verification is never disabled. A trusted chain must be verified again
// without the expected DNSName to disambiguate host mismatch from invalid CA.
func privateProbeTLSNameMismatchAt(ctx context.Context, identity string,
	roots *x509.CertPool, address string) (privateTLSNameMismatchOnly, error) {
	fail := func() (privateTLSNameMismatchOnly, error) { return privateTLSNameMismatchOnly{}, errUntrusted }
	if ctx == nil || ctx.Err() != nil || address == "" ||
		(!validDomain(identity) && !validLANIP(identity)) {
		return fail()
	}
	bounded, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	dialer := &tls.Dialer{
		NetDialer: &net.Dialer{Timeout: 2 * time.Second, KeepAlive: -1},
		Config:    &tls.Config{RootCAs: roots, ServerName: identity, MinVersion: tls.VersionTLS12},
	}
	conn, err := dialer.DialContext(bounded, "tcp", address)
	if conn != nil {
		_ = conn.Close()
	}
	if err == nil || bounded.Err() != nil {
		return fail()
	}
	var verification *tls.CertificateVerificationError
	var wrongName x509.HostnameError
	if !errors.As(err, &verification) || !errors.As(verification.Err, &wrongName) ||
		wrongName.Host != identity || len(verification.UnverifiedCertificates) == 0 ||
		wrongName.Certificate == nil {
		return fail()
	}
	certs := verification.UnverifiedCertificates
	leaf := certs[0]
	if !bytes.Equal(wrongName.Certificate.Raw, leaf.Raw) {
		return fail()
	}
	intermediates := x509.NewCertPool()
	for _, cert := range certs[1:] {
		intermediates.AddCert(cert)
	}
	// HostnameError can precede trust-path checks in certificate verification:
	// explicitly verify the complete chain, validity and ServerAuth usage.
	_, err = leaf.Verify(x509.VerifyOptions{
		Roots: roots, Intermediates: intermediates, CurrentTime: time.Now(),
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	})
	if err != nil || bounded.Err() != nil {
		return fail()
	}
	sum := sha256.New()
	_, _ = sum.Write([]byte("xdrive.caddy.host.unmatched-tls-name-observation.v1\n" + identity + "\n" + address + "\n"))
	_, _ = sum.Write(leaf.Raw)
	return privateTLSNameMismatchOnly{digest: hex.EncodeToString(sum.Sum(nil))}, nil
}

// Default domain is the fixed loopback Host listener; no DNS resolution, URL,
// proxy, user-provided network address or bypassed system trust roots.
func privateProbeDisabledDomainNameMismatch(ctx context.Context, domain string) (privateTLSNameMismatchOnly, error) {
	if !validDomain(domain) {
		return privateTLSNameMismatchOnly{}, errUntrusted
	}
	return privateProbeTLSNameMismatchAt(ctx, domain, nil, net.JoinHostPort("127.0.0.1", privateHostHTTPSPort))
}

// A Host-owned private IPv4 and operator-pinned Local CA are both required.
// This only reports a trusted *wrong-name* certificate; it is NOT a LAN-off
// proof. The Host must separately verify disabled-entry HTTP/TLS/auth policy.
func privateProbeDisabledLANNameMismatch(ctx context.Context, ip string, roots *x509.CertPool) (privateTLSNameMismatchOnly, error) {
	if !validLANIP(ip) || roots == nil || !hostOwnsIP(ip) {
		return privateTLSNameMismatchOnly{}, errUntrusted
	}
	return privateProbeTLSNameMismatchAt(ctx, ip, roots, net.JoinHostPort(ip, privateHostHTTPSPort))
}
