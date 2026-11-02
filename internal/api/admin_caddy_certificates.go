package api

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// The inventory is an ADMIN-only, read-only description of certificates
// actually presented by the fixed Caddy container. It is never a proof of
// public DNS/WAN reachability or a client/device trust decision.
type caddyCertificateInventory struct {
	Scope  string                    `json:"scope"`
	Domain caddyPresentedCertificate `json:"domain"`
	LAN    caddyPresentedCertificate `json:"lan"`
	RootCA *caddyPublicRootCA        `json:"root_ca,omitempty"`
}

type caddyPresentedCertificate struct {
	State             string   `json:"state"` // disabled / unverified / verified-local
	DNSNames          []string `json:"dns_names,omitempty"`
	IPAddresses       []string `json:"ip_addresses,omitempty"`
	NotBefore         string   `json:"not_before,omitempty"`
	NotAfter          string   `json:"not_after,omitempty"`
	LeafSHA256        string   `json:"leaf_sha256,omitempty"`
	ChainRootSHA256   string   `json:"chain_root_sha256,omitempty"`
	ChainRootNotAfter string   `json:"chain_root_not_after,omitempty"`
	Issuer            string   `json:"issuer,omitempty"`
	LeafPEM           string   `json:"leaf_pem,omitempty"`
	VerifiedAt        string   `json:"verified_at,omitempty"`
}

type caddyPublicRootCA struct {
	SHA256   string `json:"sha256"`
	NotAfter string `json:"not_after"`
	PEM      string `json:"pem"`
}

// Never accept an arbitrary browser-supplied hostname, URL, port, proxy or
// redirect. The server can only dial the well-known Docker Compose Caddy
// service. TLS name verification uses the Host-owned, validated .env entry.
const caddyCertificateTLSAddress = "caddy:443"
const caddyCertificateRootURL = "http://caddy:80/_xdrive/desktop/lan-root.crt"

func caddyCertificateSHA256(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func caddyVerifiedPublicCARoot(raw []byte, now time.Time) (*x509.Certificate, string, error) {
	if len(raw) < 256 || len(raw) > 8192 {
		return nil, "", errors.New("Caddy root size out of range")
	}
	block, rest := pem.Decode(raw)
	if block == nil || block.Type != "CERTIFICATE" ||
		len(block.Headers) != 0 || len(strings.TrimSpace(string(rest))) != 0 {
		return nil, "", errors.New("expected a single PEM certificate")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil || !cert.IsCA || !cert.BasicConstraintsValid ||
		cert.KeyUsage&x509.KeyUsageCertSign == 0 ||
		now.Before(cert.NotBefore) || !now.Before(cert.NotAfter) ||
		cert.CheckSignatureFrom(cert) != nil {
		return nil, "", errors.New("Caddy root is not a valid self-signed CA")
	}
	return cert, string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw})), nil
}

func caddyReadPublicRoot(ctx context.Context) (*x509.Certificate, string, error) {
	transport := &http.Transport{
		Proxy: nil, DisableKeepAlives: true,
		DialContext:           (&net.Dialer{Timeout: 2 * time.Second}).DialContext,
		ResponseHeaderTimeout: 2 * time.Second,
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport: transport, Timeout: 4 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("Caddy certificate redirects are forbidden")
		},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, caddyCertificateRootURL, nil)
	if err != nil {
		return nil, "", err
	}
	request.Header.Set("Accept", "application/x-pem-file")
	response, err := client.Do(request)
	if err != nil {
		return nil, "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, "", errors.New("Caddy root unavailable")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 8193))
	if err != nil {
		return nil, "", err
	}
	return caddyVerifiedPublicCARoot(body, time.Now())
}

func caddyVerifiedPresentedLeaf(ctx context.Context, name string, roots *x509.CertPool) (*x509.Certificate, *x509.Certificate, error) {
	// In particular, never set InsecureSkipVerify. Go verifies both SAN/IP
	// identity and chain validity. IP literals deliberately send no SNI;
	// Caddy's configured default_sni selects the IP SAN certificate.
	dialer := &tls.Dialer{
		NetDialer: &net.Dialer{Timeout: 3 * time.Second},
		Config: &tls.Config{
			MinVersion: tls.VersionTLS12, ServerName: name, RootCAs: roots,
		},
	}
	connection, err := dialer.DialContext(ctx, "tcp", caddyCertificateTLSAddress)
	if err != nil {
		return nil, nil, err
	}
	defer connection.Close()
	tlsConnection, ok := connection.(*tls.Conn)
	if !ok {
		return nil, nil, errors.New("expected a TLS connection")
	}
	verified := tlsConnection.ConnectionState()
	if len(verified.VerifiedChains) == 0 || len(verified.PeerCertificates) == 0 {
		return nil, nil, errors.New("certificate chain not verified")
	}
	leaf := verified.PeerCertificates[0]
	if err := leaf.VerifyHostname(name); err != nil {
		return nil, nil, err
	}
	return leaf, verified.VerifiedChains[0][len(verified.VerifiedChains[0])-1], nil
}

func caddyCertificateDetails(leaf *x509.Certificate) caddyPresentedCertificate {
	out := caddyPresentedCertificate{
		State:      "verified-local",
		NotBefore:  leaf.NotBefore.UTC().Format(time.RFC3339),
		NotAfter:   leaf.NotAfter.UTC().Format(time.RFC3339),
		LeafSHA256: caddyCertificateSHA256(leaf.Raw),
		LeafPEM:    string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leaf.Raw})),
		VerifiedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if len(leaf.Issuer.CommonName) <= 128 {
		out.Issuer = leaf.Issuer.CommonName
	}
	for _, name := range leaf.DNSNames {
		if len(out.DNSNames) >= 16 {
			break
		}
		if len(name) <= 253 {
			out.DNSNames = append(out.DNSNames, name)
		}
	}
	for _, ip := range leaf.IPAddresses {
		if len(out.IPAddresses) >= 16 {
			break
		}
		out.IPAddresses = append(out.IPAddresses, ip.String())
	}
	return out
}

func (s *Server) caddyCertificateInventory(ctx context.Context, snap caddyHostEnvSnapshot, host caddyHostStatus, observed bool) caddyCertificateInventory {
	out := caddyCertificateInventory{
		Scope:  "caddy-container-local-v1",
		Domain: caddyPresentedCertificate{State: "disabled"},
		LAN:    caddyPresentedCertificate{State: "disabled"},
	}
	if snap.DomainEnabled {
		out.Domain.State = "unverified"
	}
	if snap.LANEnabled {
		out.LAN.State = "unverified"
	}
	// .env intent or a historical "deployed" receipt cannot certify the
	// currently served certificate. Respect short-lived Host observations.
	if !observed || host.State != "healthy" || snap.PendingRedeploy {
		return out
	}
	if snap.DomainEnabled && host.HTTPSConfigured && host.TLSState == "verified" &&
		host.TLSVerifiedDomainSHA256 == caddyCertificateSHA256([]byte(strings.ToLower(snap.Domain))) {
		if leaf, root, err := caddyVerifiedPresentedLeaf(ctx, snap.Domain, nil); err == nil {
			out.Domain = caddyCertificateDetails(leaf)
			out.Domain.ChainRootSHA256 = caddyCertificateSHA256(root.Raw)
			out.Domain.ChainRootNotAfter = root.NotAfter.UTC().Format(time.RFC3339)
		}
	}
	if snap.LANEnabled && host.LANHTTPSConfigured && host.LANTLSState == "verified" &&
		host.LANVerifiedIPSHA256 == caddyCertificateSHA256([]byte(snap.LANIP)) {
		// A public root read over the fixed internal Caddy route is never
		// accepted as an identity proof by itself. It must validate the
		// CURRENT leaf via a second strict TLS/IP-SAN handshake.
		ca, publicPEM, err := caddyReadPublicRoot(ctx)
		if err == nil {
			pool := x509.NewCertPool()
			pool.AddCert(ca)
			if leaf, _, handshakeErr := caddyVerifiedPresentedLeaf(ctx, snap.LANIP, pool); handshakeErr == nil {
				out.LAN = caddyCertificateDetails(leaf)
				out.RootCA = &caddyPublicRootCA{
					SHA256:   caddyCertificateSHA256(ca.Raw),
					NotAfter: ca.NotAfter.UTC().Format(time.RFC3339),
					PEM:      publicPEM,
				}
			}
		}
	}
	return out
}
