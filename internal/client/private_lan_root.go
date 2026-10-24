package client

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ValidPrivateLANRoot enforces an IP-scoped trust anchor. A private root must
// never be usable for a public domain, an arbitrary origin, or HTTP transport.
func ValidPrivateLANRoot(server, rootPEM string) error {
	if len(rootPEM) == 0 || len(rootPEM) > 8192 {
		return errors.New("invalid private LAN root size")
	}
	u, err := url.Parse(server)
	if err != nil || u == nil || u.Scheme != "https" || u.User != nil ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" ||
		u.Hostname() == "" {
		return errors.New("trusted LAN root requires an HTTPS private IPv4 origin")
	}
	ip := net.ParseIP(u.Hostname())
	if ip == nil || ip.To4() == nil || !ip.IsPrivate() {
		return errors.New("trusted LAN root requires an RFC1918 IPv4")
	}
	block, rest := pem.Decode([]byte(rootPEM))
	if block == nil || block.Type != "CERTIFICATE" ||
		len(strings.TrimSpace(string(rest))) != 0 || len(block.Headers) != 0 {
		return errors.New("trusted LAN root must be exactly one PEM certificate")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil || !cert.IsCA || cert.Subject.String() != cert.Issuer.String() ||
		(cert.KeyUsage&x509.KeyUsageCertSign) == 0 ||
		cert.CheckSignatureFrom(cert) != nil ||
		time.Now().Before(cert.NotBefore) || !time.Now().Before(cert.NotAfter) {
		return errors.New("trusted LAN root is not a current self-signed CA")
	}
	return nil
}

// ConfigurePrivateLANRoot replaces system trust ONLY for this Client's pinned
// private-IP origin. No OS trust store, proxy, SSL override or global agent
// transport is changed. Normal TLS verification checks chain, dates and IP SAN.
func (c *Client) ConfigurePrivateLANRoot(rootPEM string) error {
	if err := ValidPrivateLANRoot(c.BaseURL, rootPEM); err != nil {
		return err
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(rootPEM)) {
		return errors.New("cannot parse trusted LAN root")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil // Never proxy private LAN requests or bearer tokens.
	transport.TLSClientConfig = &tls.Config{
		RootCAs:    roots,
		MinVersion: tls.VersionTLS12,
	}
	if c.HTTP == nil {
		c.HTTP = &http.Client{}
	}
	c.HTTP.Transport = transport
	c.HTTP.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return ErrAuthRedirect
	}
	return nil
}
