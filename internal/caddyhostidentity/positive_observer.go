package caddyhostidentity

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/netip"
	"time"
)

const (
	privateHostHTTPSPort = "8443"
	maxReadyReplyBytes   = 1024
)

// localTLSReadyEvidence is a HOST-PRIVATE snapshot of a real HTTPS/Ready probe.
// It is not an independent negative-ingress proof, administrative authorization,
// Caddy generation proof, signed applied receipt, or WAN/client reachability.
// Only a digest is retained, never the hostname/IP or raw TLS/HTTP response.
type localTLSReadyEvidence struct {
	digest string
}

// probeCaddyDomainReady performs an actual local TLS SNI, public-root and
// public Ready handshake. The network destination is ALWAYS the local Caddy
// listener, never a DNS-resolved address, proxy or caller-provided URL.
// This is weaker than the complete signed Host identity and grants no authority.
func probeCaddyDomainReady(ctx context.Context, fqdn string) (localTLSReadyEvidence, error) {
	if !validDomain(fqdn) {
		return localTLSReadyEvidence{}, errUntrusted
	}
	return probeBoundLocalTLSReady(ctx, fqdn, nil, net.JoinHostPort("127.0.0.1", privateHostHTTPSPort), privateHostHTTPSPort)
}

// probeCaddyLANReady validates the real local RFC1918 interface and pins the
// private IP as both TCP destination and certificate IP SAN identity. A trusted
// local CA must be supplied from an operator-private source, NEVER from HTTP.
func probeCaddyLANReady(ctx context.Context, ip string, roots *x509.CertPool) (localTLSReadyEvidence, error) {
	if !validLANIP(ip) || roots == nil || !hostOwnsIP(ip) {
		return localTLSReadyEvidence{}, errUntrusted
	}
	return probeBoundLocalTLSReady(ctx, ip, roots, net.JoinHostPort(ip, privateHostHTTPSPort), privateHostHTTPSPort)
}

func hostOwnsIP(value string) bool {
	wanted, err := netip.ParseAddr(value)
	if err != nil || !wanted.Is4() || !wanted.IsPrivate() {
		return false
	}
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		return false
	}
	for _, address := range addresses {
		network, ok := address.(*net.IPNet)
		if !ok {
			continue
		}
		if got, ok := netip.AddrFromSlice(network.IP); ok && got.Unmap() == wanted {
			return true
		}
	}
	return false
}

// probeBoundLocalTLSReady has a package-private override solely for synthetic
// same-process TLS tests. Production wrappers always supply host-owned :8443.
// No redirects, Cookie jar, proxy, Authorization, insecure TLS, or DNS dial.
func probeBoundLocalTLSReady(ctx context.Context, identity string, roots *x509.CertPool, fixedAddr, port string) (localTLSReadyEvidence, error) {
	fail := func() (localTLSReadyEvidence, error) { return localTLSReadyEvidence{}, errUntrusted }
	if ctx == nil || ctx.Err() != nil || fixedAddr == "" || port == "" {
		return fail()
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	dialer := &net.Dialer{Timeout: 2 * time.Second, KeepAlive: -1}
	tlsConfig := &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}
	tr := &http.Transport{
		Proxy: nil, TLSClientConfig: tlsConfig, DisableKeepAlives: true,
		DisableCompression: true, ForceAttemptHTTP2: false,
		TLSNextProto: map[string]func(string, *tls.Conn) http.RoundTripper{},
		DialContext: func(callCtx context.Context, network, addr string) (net.Conn, error) {
			if network != "tcp" || addr != net.JoinHostPort(identity, port) {
				return nil, errUntrusted
			}
			return dialer.DialContext(callCtx, "tcp", fixedAddr)
		},
	}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, err := http.NewRequestWithContext(timeoutCtx, http.MethodGet, "https://"+net.JoinHostPort(identity, port)+"/api/v1/readyz", nil)
	if err != nil {
		return fail()
	}
	req.Header.Set("Accept", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return fail()
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.TLS == nil || len(response.TLS.VerifiedChains) == 0 || len(response.TLS.PeerCertificates) == 0 {
		return fail()
	}
	if response.Header.Get("Content-Type") != "application/json; charset=utf-8" && response.Header.Get("Content-Type") != "application/json" {
		return fail()
	}
	if response.ContentLength > maxReadyReplyBytes {
		return fail()
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxReadyReplyBytes+1))
	if err != nil || len(raw) > maxReadyReplyBytes {
		return fail()
	}
	defer clear(raw)
	var reply map[string]json.RawMessage
	decoder := json.NewDecoder(bytes.NewReader(raw))
	var trailing any
	if decoder.Decode(&reply) != nil || decoder.Decode(&trailing) != io.EOF {
		return fail()
	}
	if len(reply) == 0 || string(reply["ok"]) != "true" {
		return fail()
	}
	peer := response.TLS.PeerCertificates[0]
	sum := sha256.New()
	_, _ = io.WriteString(sum, "xdrive.caddy.host.local-tls-ready.v1\n")
	_, _ = io.WriteString(sum, identity+"\n"+port+"\n"+fixedAddr+"\n")
	_, _ = sum.Write(peer.Raw)
	_, _ = sum.Write(raw)
	return localTLSReadyEvidence{digest: hex.EncodeToString(sum.Sum(nil))}, nil
}
