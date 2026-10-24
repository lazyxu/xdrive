package caddyhostidentity

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

const retiredTestRoutes = `{"apps":{"http":{"servers":{"srv0":{"listen":[":443"],"routes":[{"match":[{"host":["current.example.test"]}],"handle":[{"handler":"subroute"}]}]},"srv1":{"listen":[":80"],"routes":[{"handle":[{"handler":"reverse_proxy"}]}]}}}}}`

func retiredTestHash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func TestCurrentHostRouteMapRejectsRetiredOriginAndLeakingEvidence(t *testing.T) {
	current := privateHostEnabledTargets{domain: "current.example.test"}
	retired := privateRetiredTargets{domain: "former.example.test"}
	evidence, err := privateVerifyRetiredRouteAbsent([]byte(retiredTestRoutes), retiredTestHash(retiredTestRoutes), current, retired)
	if err != nil || !validDigest(evidence.digest) {
		t.Fatalf("valid fixed HTTPS route map rejected: %v", err)
	}
	// Built-in TLS/PKI/events companion modules do not themselves add
	// an independent listener and remain supported by this conservative map.
	standard := strings.Replace(retiredTestRoutes, `"apps":{"http":`, `"apps":{"tls":{},"pki":{},"events":{},"http":`, 1)
	if _, err := privateVerifyRetiredRouteAbsent([]byte(standard), retiredTestHash(standard), current, retired); err != nil {
		t.Fatalf("standard Caddy apps rejected: %v", err)
	}
	raw, err := json.Marshal(evidence)
	if err != nil || string(raw) != "{}" {
		t.Fatal("private Host route digest was serialized")
	}
}

func TestCurrentHostRoutesRejectAmbiguousOrStaleNegativeEvidence(t *testing.T) {
	current := privateHostEnabledTargets{domain: "current.example.test"}
	retired := privateRetiredTargets{domain: "former.example.test"}
	for _, tc := range []struct{ name, raw string }{
		{"retired still enabled", strings.Replace(retiredTestRoutes, "current.example.test", "former.example.test", 1)},
		{"missing active origin", strings.Replace(retiredTestRoutes, "current.example.test", "other.example.test", 1)},
		{"catchall HTTPS", strings.Replace(retiredTestRoutes, `"match":[{"host":["current.example.test"]}],`, "", 1)},
		{"wildcard", strings.Replace(retiredTestRoutes, "current.example.test", "*.example.test", 1)},
		{"unscoped OR", strings.Replace(retiredTestRoutes, `"match":[{"host":["current.example.test"]}]`, `"match":[{"host":["current.example.test"]},{"path":["/*"]}]`, 1)},
		{"host with NOT matcher", strings.Replace(retiredTestRoutes, `"host":["current.example.test"]`, `"host":["current.example.test"],"not":[{"host":["former.example.test"]}]`, 1)},
		{"host with expression matcher", strings.Replace(retiredTestRoutes, `"host":["current.example.test"]`, `"host":["current.example.test"],"expression":"true"`, 1)},
		{"HTTP only", strings.Replace(retiredTestRoutes, ":443", ":80", 1)},
		{"unsupported listener", strings.Replace(retiredTestRoutes, ":443", ":8443", 1)},
		// Caddy apps are independently loaded modules; HTTP routes are not a
		// complete ingress inventory when a plugin can handle the TLS socket.
		{"layer4 TLS bypass", strings.Replace(retiredTestRoutes, `"apps":{"http":`, `"apps":{"layer4":{"servers":{"s":{"listen":[":443"],"routes":[]}}},"http":`, 1)},
		{"unknown ingress app", strings.Replace(retiredTestRoutes, `"apps":{"http":`, `"apps":{"custom_tls_proxy":{},"http":`, 1)},
		{"malformed", "{"},
		{"trailing JSON", retiredTestRoutes + "{}"},
		{"too large", strings.Repeat(" ", maxHostPrivateRouteJSON+1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := privateVerifyRetiredRouteAbsent([]byte(tc.raw), retiredTestHash(tc.raw), current, retired)
			if err == nil || got.digest != "" {
				t.Fatal("unsafe retired origin evidence accepted")
			}
		})
	}
	if _, err := privateVerifyRetiredRouteAbsent([]byte(retiredTestRoutes), strings.Repeat("f", 64), current, retired); err == nil {
		t.Fatal("historical/unbound route digest admitted")
	}
}

func TestRetiredRouteRequiresAllCurrentHTTPSOrigins(t *testing.T) {
	current := privateHostEnabledTargets{domain: "current.example.test", lanIPv4: "192.168.2.4"}
	retired := privateRetiredTargets{domain: "former.example.test", lanIPv4: "192.168.2.5"}
	if _, err := privateVerifyRetiredRouteAbsent([]byte(retiredTestRoutes), retiredTestHash(retiredTestRoutes), current, retired); err == nil {
		t.Fatal("missing active LAN HTTPS route admitted")
	}
	both := strings.Replace(retiredTestRoutes, `"host":["current.example.test"]`, `"host":["current.example.test","192.168.2.4"]`, 1)
	if _, err := privateVerifyRetiredRouteAbsent([]byte(both), retiredTestHash(both), current, retired); err != nil {
		t.Fatalf("both active HTTPS identities were rejected: %v", err)
	}
	for _, bad := range []privateRetiredTargets{{domain: "current.example.test"}, {lanIPv4: "192.168.2.4"}, {}} {
		if _, err := privateVerifyRetiredRouteAbsent([]byte(both), retiredTestHash(both), current, bad); err == nil {
			t.Fatal("active identity was accepted as retired")
		}
	}
}

// Even a valid 421 transport response and a plain top-level Host route
// cannot prove retirement when Caddy has a separate error, named or TLS path.
func TestRetiredRouteRejectsIndependentBackend421Paths(t *testing.T) {
	current := privateHostEnabledTargets{domain: "current.example.test"}
	retired := privateRetiredTargets{domain: "former.example.test"}
	for _, tc := range []struct{ name, extra string }{
		{"backend error route", `"errors":{"routes":[{"handle":[{"handler":"reverse_proxy"}]}]},`},
		{"named alternate route", `"named_routes":{"other":{"handle":[{"handler":"reverse_proxy"}]}},`},
		{"listener wrapper", `"listener_wrappers":[{"wrapper":"proxy_protocol"}],`},
		{"retired fallback SNI", `"tls_connection_policies":[{"fallback_sni":"former.example.test"}],`},
		{"retired TLS policy SNI", `"tls_connection_policies":[{"match":{"sni":["former.example.test"]}}],`},
		{"ambiguous capitalized routes", `"Routes":[{"match":[{"host":["current.example.test"]}]}],`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config := strings.Replace(retiredTestRoutes, `"routes":`, tc.extra+`"routes":`, 1)
			result, err := privateVerifyRetiredRouteAbsent([]byte(config), retiredTestHash(config), current, retired)
			if err == nil || result.digest != "" {
				t.Fatal("non-HTTP or backend-forged 421 ingress falsely accepted")
			}
		})
	}
}

func TestPrivateRouteSamplerBoundedAndCancelled(t *testing.T) {
	if privateCaddyLiveConfigBodyScript != "wget -q -T 2 -O - http://127.0.0.1:2019/config/" {
		t.Fatal("untrusted Caddy URL or Docker script")
	}
	o := &privateLimitedRouteBody{}
	if n, err := o.Write([]byte(strings.Repeat("a", maxHostPrivateRouteJSON))); err != nil || n != maxHostPrivateRouteJSON {
		t.Fatal("bounded config accepted neither exact limit nor bytes")
	}
	if n, err := o.Write([]byte("extra")); err == nil || n != 0 {
		t.Fatal("oversized private Caddy config accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := runPrivateCaddyRouteSample(ctx); err == nil {
		t.Fatal("cancelled Host Docker read executed")
	}
	if _, err := runPrivateCaddyRouteSample(nil); err == nil {
		t.Fatal("nil-context Docker read executed")
	}
}
