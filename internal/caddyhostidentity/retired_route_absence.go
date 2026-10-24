package caddyhostidentity

import (
	"bytes"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"io"
	"strings"
)

const maxHostPrivateRouteJSON = 128 << 10

// privateRetiredTargets must eventually be reconstructed from an independently
// authenticated, immutable earlier Host operation. NEVER use DB Desired, a
// browser field or an unsigned local snapshot as provenance for these values.
type privateRetiredTargets struct {
	domain   string
	lanIPv4  string
	lanRoots *x509.CertPool
}

// privateRetiredRouteCandidate proves ONLY that one exact-digest snapshot of
// running Caddy JSON has no HTTPS host matcher for the retired origin. It is
// neither an actual network-negative proof nor a current signed Applied claim.
type privateRetiredRouteCandidate struct{ digest string }

type caddyRouteMatches struct {
	Match []json.RawMessage `json:"match"`
}
type caddyActiveHTTPServer struct {
	Listen []string            `json:"listen"`
	Routes []caddyRouteMatches `json:"routes"`
}
type caddyActiveRoutesDocument struct {
	Apps struct {
		HTTP struct {
			Servers map[string]caddyActiveHTTPServer `json:"servers"`
		} `json:"http"`
	} `json:"apps"`
}

// Reject catch-all, wildcard, unknown listener, unscoped OR arm, malformed
// or stale in-memory configuration rather than infer disabled ingress from
// a saved Caddyfile, TCP failure, HTTP 404 or historical success receipt.
// Caller MUST obtain raw from the private fixed Caddy admin sampler and bind
// its digest to an independently rechecked running generation.
func privateVerifyRetiredRouteAbsent(raw []byte, pinnedLiveSHA string,
	current privateHostEnabledTargets, retired privateRetiredTargets) (privateRetiredRouteCandidate, error) {
	fail := func() (privateRetiredRouteCandidate, error) { return privateRetiredRouteCandidate{}, errUntrusted }
	if !privateHasUnambiguousCaddyJSON(raw) ||
		!privateCaddyIngressPerimeterValid(raw, current) ||
		len(raw) == 0 || len(raw) > maxHostPrivateRouteJSON || !validDigest(pinnedLiveSHA) ||
		(current.domain == "" && current.lanIPv4 == "") ||
		(retired.domain == "" && retired.lanIPv4 == "") {
		return fail()
	}
	if (current.domain != "" && !validDomain(current.domain)) ||
		(current.lanIPv4 != "" && !validLANIP(current.lanIPv4)) ||
		(retired.domain != "" && (!validDomain(retired.domain) || retired.domain == current.domain)) ||
		(retired.lanIPv4 != "" && (!validLANIP(retired.lanIPv4) || retired.lanIPv4 == current.lanIPv4)) {
		return fail()
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != pinnedLiveSHA {
		return fail()
	}
	var doc caddyActiveRoutesDocument
	decoder := json.NewDecoder(bytes.NewReader(raw))
	var trailing any
	if decoder.Decode(&doc) != nil || decoder.Decode(&trailing) != io.EOF ||
		len(doc.Apps.HTTP.Servers) == 0 {
		return fail()
	}
	// The HTTP route map alone cannot prove ingress absence when another
	// Caddy App (for example third-party layer4) can independently accept
	// TCP/TLS connections. Accept only standard non-ingress companion apps;
	// unknown apps make this a private unverified candidate.
	var modules struct {
		Apps map[string]json.RawMessage `json:"apps"`
	}
	if json.Unmarshal(raw, &modules) != nil {
		return fail()
	}
	for name := range modules.Apps {
		switch name {
		case "http", "tls", "pki", "events":
		default:
			return fail()
		}
	}
	seenTLS, seenDomain, seenLAN := false, false, false
	for _, server := range doc.Apps.HTTP.Servers {
		if len(server.Listen) == 0 {
			return fail()
		}
		isTLS := false
		for _, listener := range server.Listen {
			switch listener {
			case ":443", "0.0.0.0:443", "[::]:443":
				isTLS = true
			case ":80", "0.0.0.0:80", "[::]:80":
			default:
				return fail()
			}
		}
		if !isTLS {
			continue
		}
		seenTLS = true
		if len(server.Routes) == 0 {
			return fail()
		}
		for _, route := range server.Routes {
			if len(route.Match) == 0 {
				return fail()
			}
			for _, arm := range route.Match {
				var selector map[string]json.RawMessage
				if json.Unmarshal(arm, &selector) != nil || len(selector) != 1 {
					return fail()
				}
				rawHosts, ok := selector["host"]
				if !ok {
					return fail()
				}
				var hosts []string
				if json.Unmarshal(rawHosts, &hosts) != nil || len(hosts) == 0 {
					return fail()
				}
				for _, host := range hosts {
					if (!validDomain(host) && !validLANIP(host)) ||
						strings.Contains(host, "*") || host == retired.domain ||
						host == retired.lanIPv4 {
						return fail()
					}
					if current.domain != "" && host == current.domain {
						seenDomain = true
					}
					if current.lanIPv4 != "" && host == current.lanIPv4 {
						seenLAN = true
					}
				}
			}
		}
	}
	if !seenTLS || (current.domain != "" && !seenDomain) ||
		(current.lanIPv4 != "" && !seenLAN) {
		return fail()
	}
	fingerprint := sha256.New()
	_, _ = io.WriteString(fingerprint, "xdrive.caddy.retired-routes.absent.v1\n")
	_, _ = fingerprint.Write(raw)
	_, _ = io.WriteString(fingerprint, "\n"+retired.domain+"\n"+retired.lanIPv4+"\n")
	return privateRetiredRouteCandidate{digest: hex.EncodeToString(fingerprint.Sum(nil))}, nil
}
