package caddyhostidentity

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const retiredOriginResponseLimit = 128

// localRetiredOriginCandidate holds ONLY a private transport digest, not a
// trusted network-negative or signed Applied result. The old-SNI/old-Host
// 421 probe below remains for narrowly scoped legacy synthetic tests only:
// it cannot prove real retirement because the old cert may no longer exist
// and TLS SNI=HTTP Host does not trigger Caddy strict-SNI mismatch 421.
// Production calls privateProbeNativeRetiredHost instead.
type localRetiredOriginCandidate struct {
	digest      string
	peerLeafSHA string // optional for historical fixtures; required for production current-TLS candidates
}

// probeRetiredDomainCandidate uses the existing Caddy listener on loopback,
// not DNS, a proxy or a caller-selected URL. A missing certificate, rejected
// TLS handshake or transport error is unknown, NOT evidence of retirement.
func probeRetiredDomainCandidate(ctx context.Context, domain string) (localRetiredOriginCandidate, error) {
	if !validDomain(domain) {
		return localRetiredOriginCandidate{}, errUntrusted
	}
	return probeBoundRetiredOriginCandidate(ctx, domain, nil,
		net.JoinHostPort("127.0.0.1", privateHostHTTPSPort), privateHostHTTPSPort)
}

// A retired LAN IP is checked only while it is still owned by this Host and
// a trusted operator-private CA is supplied. Otherwise the result is unknown.
func probeRetiredLANCandidate(ctx context.Context, ip string, roots *x509.CertPool) (localRetiredOriginCandidate, error) {
	if !validLANIP(ip) || roots == nil || !hostOwnsIP(ip) {
		return localRetiredOriginCandidate{}, errUntrusted
	}
	return probeBoundRetiredOriginCandidate(ctx, ip, roots,
		net.JoinHostPort(ip, privateHostHTTPSPort), privateHostHTTPSPort)
}

// Package-private test seam; callers cannot select the production network
// destination. Even a successful result is NOT a signed negative proof until
// the Collector independently validates the running Caddy route map and
// binds the Host source to a durable operation and mutation/continuity fence.
func probeBoundRetiredOriginCandidate(ctx context.Context, identity string,
	roots *x509.CertPool, fixedAddr, port string) (localRetiredOriginCandidate, error) {
	fail := func() (localRetiredOriginCandidate, error) { return localRetiredOriginCandidate{}, errUntrusted }
	if ctx == nil || ctx.Err() != nil || fixedAddr == "" || port == "" ||
		(!validDomain(identity) && !validLANIP(identity)) {
		return fail()
	}
	deadline, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	dialer := &net.Dialer{Timeout: 2 * time.Second, KeepAlive: -1}
	transport := &http.Transport{
		Proxy:              nil,
		TLSClientConfig:    &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12},
		DisableKeepAlives:  true,
		DisableCompression: true,
		ForceAttemptHTTP2:  false,
		TLSNextProto:       map[string]func(string, *tls.Conn) http.RoundTripper{},
		DialContext: func(callCtx context.Context, network, address string) (net.Conn, error) {
			if network != "tcp" || address != net.JoinHostPort(identity, port) {
				return nil, errUntrusted
			}
			return dialer.DialContext(callCtx, "tcp", fixedAddr)
		},
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport:     transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	request, err := http.NewRequestWithContext(deadline, http.MethodGet,
		"https://"+net.JoinHostPort(identity, port)+"/api/v1/readyz", nil)
	if err != nil {
		return fail()
	}
	request.Header.Set("Accept", "text/plain")
	response, err := client.Do(request)
	if err != nil {
		return fail()
	}
	defer response.Body.Close()
	// Refuse 200, 401/403, 404, redirects, 502/503, TLS failures and ANY
	// ambiguous HTTP status. A genuine *authenticated TLS* 421 on the former
	// origin is only a bounded negative transport candidate.
	if response.StatusCode != http.StatusMisdirectedRequest || response.TLS == nil ||
		len(response.TLS.VerifiedChains) == 0 || len(response.TLS.PeerCertificates) == 0 ||
		response.Header.Get("Location") != "" || response.Header.Get("Set-Cookie") != "" ||
		response.Header.Get("WWW-Authenticate") != "" ||
		response.ContentLength > retiredOriginResponseLimit || deadline.Err() != nil {
		return fail()
	}
	ct := response.Header.Get("Content-Type")
	if ct != "" && ct != "text/plain" && ct != "text/plain; charset=utf-8" {
		return fail()
	}
	reply, err := io.ReadAll(io.LimitReader(response.Body, retiredOriginResponseLimit+1))
	if err != nil || len(reply) > retiredOriginResponseLimit {
		return fail()
	}
	defer clear(reply)
	for _, b := range reply {
		if b != '\n' && b != '\r' && b != '\t' && (b < 32 || b > 126) {
			return fail()
		}
	}
	// Never treat JSON, SPA HTML or an authenticated backend error response
	// as a disabled-origin proof, even if that backend forged status 421.
	trimmed := strings.TrimSpace(string(reply))
	if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") ||
		strings.HasPrefix(trimmed, "<") {
		return fail()
	}
	proof := sha256.New()
	_, _ = io.WriteString(proof, "xdrive.caddy.host.retired-origin-transport.v1\n")
	_, _ = io.WriteString(proof, identity+"\n"+port+"\n"+fixedAddr+"\n")
	_, _ = proof.Write(response.TLS.PeerCertificates[0].Raw)
	_, _ = proof.Write(reply)
	return localRetiredOriginCandidate{digest: hex.EncodeToString(proof.Sum(nil))}, nil
}
