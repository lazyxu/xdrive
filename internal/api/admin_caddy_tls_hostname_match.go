package api

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
)

// This is only a comparison of a saved desired FQDN with a fresh fixed-host
// observation of the name whose TLS certificate passed a local loopback
// handshake. It never authenticates the desired revision or proves public
// HTTPS, ingress reachability, safe Caddy apply, or a rollback guarantee.
func caddyDesiredDomainLocalMatch(
	desired adminCaddyHTTPSDesired, host caddyHostStatus, hostObserved bool,
) string {
	if desired.Revision == 0 || !desired.Enabled ||
		!validCaddyHTTPSDomain(desired.Domain) || !hostObserved ||
		host.State != "healthy" || !host.HTTPSConfigured ||
		!host.TLSCheckSupported || host.TLSState != "verified" ||
		!validCaddyTLSVerifiedDomainDigest(host.TLSVerifiedDomainSHA256) {
		return "unverified"
	}
	digest := sha256.Sum256([]byte(strings.ToLower(desired.Domain)))
	expected := hex.EncodeToString(digest[:])
	if subtle.ConstantTimeCompare([]byte(expected), []byte(host.TLSVerifiedDomainSHA256)) == 1 {
		return "matched-local"
	}
	return "mismatch-local"
}
