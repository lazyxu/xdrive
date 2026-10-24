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

// privateProbeNativeRetiredHost uses an enabled TLS identity for certificate
// verification, but sends the original *retired* HTTP authority on that same
// connection. A removed TLS certificate for the old hostname must not be
// required to prove that the current HTTPS Host route rejects it.
// This is only a transport candidate: a separate, exact live-route proof and
// a continuous Caddy mutation fence are necessary before signed Applied.
func privateProbeNativeRetiredHost(ctx context.Context, current privateHostEnabledTargets, retiredHost string) (localRetiredOriginCandidate, error) {
	fail := func() (localRetiredOriginCandidate, error) { return localRetiredOriginCandidate{}, errUntrusted }
	if ctx == nil || ctx.Err() != nil || (!validDomain(retiredHost) && !validLANIP(retiredHost)) ||
		retiredHost == current.domain || retiredHost == current.lanIPv4 {
		return fail()
	}
	// Old LAN routes are tested through today's local LAN listener where
	// possible; old domain routes use today's public domain identity where
	// possible. Both alternatives are fixed by trusted Host .env, not HTTP.
	if privateRetiredUsesLAN(current, retiredHost) {
		if !validLANIP(current.lanIPv4) || current.lanRoots == nil || !hostOwnsIP(current.lanIPv4) {
			return fail()
		}
		return privateProbeBoundUnmatchedHost(ctx, current.lanIPv4, retiredHost, current.lanRoots,
			net.JoinHostPort(current.lanIPv4, privateHostHTTPSPort), privateHostHTTPSPort)
	}
	if !validDomain(current.domain) {
		return fail()
	}
	return privateProbeBoundUnmatchedHost(ctx, current.domain, retiredHost, nil,
		net.JoinHostPort("127.0.0.1", privateHostHTTPSPort), privateHostHTTPSPort)
}

// Exactly the same selection is used by the Collector to select which
// positive verified TLS certificate must match the retired-Host candidate.
func privateRetiredUsesLAN(current privateHostEnabledTargets, retiredHost string) bool {
	return current.lanIPv4 != "" && (validLANIP(retiredHost) || current.domain == "")
}

// The fixedAddr/port seam exists only for same-process synthetic TLS tests.
// Production callers always use fixed Host-owned local listener destinations.
func privateProbeBoundUnmatchedHost(ctx context.Context, currentIdentity, retiredHost string,
	roots *x509.CertPool, fixedAddr, port string) (localRetiredOriginCandidate, error) {
	fail := func() (localRetiredOriginCandidate, error) { return localRetiredOriginCandidate{}, errUntrusted }
	if ctx == nil || ctx.Err() != nil || fixedAddr == "" || port == "" ||
		(!validDomain(currentIdentity) && !validLANIP(currentIdentity)) ||
		(!validDomain(retiredHost) && !validLANIP(retiredHost)) ||
		currentIdentity == retiredHost || (validLANIP(currentIdentity) && roots == nil) {
		return fail()
	}
	timeout, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	dialer := &net.Dialer{Timeout: 2 * time.Second, KeepAlive: -1}
	transport := &http.Transport{
		Proxy:              nil,
		TLSClientConfig:    &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12},
		DisableKeepAlives:  true,
		DisableCompression: true,
		ForceAttemptHTTP2:  false,
		TLSNextProto:       map[string]func(string, *tls.Conn) http.RoundTripper{},
		DialContext: func(callCtx context.Context, network, addr string) (net.Conn, error) {
			if network != "tcp" || addr != net.JoinHostPort(currentIdentity, port) {
				return nil, errUntrusted
			}
			return dialer.DialContext(callCtx, "tcp", fixedAddr)
		},
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	request, err := http.NewRequestWithContext(timeout, http.MethodGet,
		"https://"+net.JoinHostPort(currentIdentity, port)+"/api/v1/readyz", nil)
	if err != nil {
		return fail()
	}
	// Deliberately separate TLS authority from retired HTTP Host. Never send
	// credentials, cookies, Referer, arbitrary URL, or proxy traffic.
	request.Host = net.JoinHostPort(retiredHost, port)
	request.Header.Set("Accept", "text/plain")
	response, err := client.Do(request)
	if err != nil {
		return fail()
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound || response.TLS == nil ||
		len(response.TLS.VerifiedChains) == 0 || len(response.TLS.PeerCertificates) == 0 ||
		response.Header.Get("Location") != "" || response.Header.Get("Set-Cookie") != "" ||
		response.Header.Get("WWW-Authenticate") != "" || response.ContentLength > retiredOriginResponseLimit ||
		timeout.Err() != nil {
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
		if b != '\r' && b != '\n' && b != '\t' && (b < 32 || b > 126) {
			return fail()
		}
	}
	trimmed := strings.TrimSpace(string(reply))
	if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") || strings.HasPrefix(trimmed, "<") {
		return fail()
	}
	sum := sha256.New()
	_, _ = io.WriteString(sum, "xdrive.caddy.host.retired-http-route-unmatched.v1\n")
	_, _ = io.WriteString(sum, currentIdentity+"\n"+retiredHost+"\n"+port+"\n"+fixedAddr+"\n")
	_, _ = sum.Write(response.TLS.PeerCertificates[0].Raw)
	_, _ = sum.Write(reply)
	leafSum := sha256.Sum256(response.TLS.PeerCertificates[0].Raw)
	return localRetiredOriginCandidate{
		digest: hex.EncodeToString(sum.Sum(nil)), peerLeafSHA: hex.EncodeToString(leafSum[:]),
	}, nil
}
