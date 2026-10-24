package caddyhostidentity

import (
	"strings"
	"testing"
)

const privatePerimeterFixture = `{"apps":{"http":{"servers":{"srv0":{"listen":[":443"],"routes":[{"match":[{"host":["active.example.test"]}]}]}}}}}`

func TestPrivateCaddyIngressPerimeterAllowsOrdinaryCaddyPolicy(t *testing.T) {
	current := privateHostEnabledTargets{domain: "active.example.test", lanIPv4: "192.168.2.4"}
	for _, raw := range []string{
		privatePerimeterFixture,
		strings.Replace(privatePerimeterFixture, `"routes":`, `"tls_connection_policies":[{}],"routes":`, 1),
		strings.Replace(privatePerimeterFixture, `"routes":`, `"tls_connection_policies":[{"default_sni":"192.168.2.4"}],"routes":`, 1),
		strings.Replace(privatePerimeterFixture, `"routes":`, `"tls_connection_policies":[{"match":{"sni":["active.example.test"]}}],"routes":`, 1),
	} {
		if !privateCaddyIngressPerimeterValid([]byte(raw), current) {
			t.Fatal("ordinary Caddy configuration rejected: ", raw)
		}
	}
}

func TestPrivateCaddyIngressPerimeterRejectsBackendAndTLSBypass(t *testing.T) {
	current := privateHostEnabledTargets{domain: "active.example.test", lanIPv4: "192.168.2.4"}
	for _, tc := range []struct{ name, raw string }{
		{"forged backend 421 error route", strings.Replace(privatePerimeterFixture, `"routes":`, `"errors":{"routes":[{"handle":[{"handler":"reverse_proxy"}]}]},"routes":`, 1)},
		{"hidden named route", strings.Replace(privatePerimeterFixture, `"routes":`, `"named_routes":{"secret":{"handle":[{"handler":"reverse_proxy"}]}},"routes":`, 1)},
		{"custom TLS listener wrapper", strings.Replace(privatePerimeterFixture, `"routes":`, `"listener_wrappers":[{"wrapper":"proxy_protocol"}],"routes":`, 1)},
		{"retired fallback SNI", strings.Replace(privatePerimeterFixture, `"routes":`, `"tls_connection_policies":[{"fallback_sni":"retired.example.test"}],"routes":`, 1)},
		{"empty fallback SNI", strings.Replace(privatePerimeterFixture, `"routes":`, `"tls_connection_policies":[{"fallback_sni":""}],"routes":`, 1)},
		{"retired default SNI", strings.Replace(privatePerimeterFixture, `"routes":`, `"tls_connection_policies":[{"default_sni":"retired.example.test"}],"routes":`, 1)},
		{"retired matched SNI", strings.Replace(privatePerimeterFixture, `"routes":`, `"tls_connection_policies":[{"match":{"sni":["retired.example.test"]}}],"routes":`, 1)},
		{"remote-ip TLS policy", strings.Replace(privatePerimeterFixture, `"routes":`, `"tls_connection_policies":[{"match":{"remote_ip":["10.0.0.0/8"]}}],"routes":`, 1)},
		{"null connection policies", strings.Replace(privatePerimeterFixture, `"routes":`, `"tls_connection_policies":null,"routes":`, 1)},
		{"case ambiguous routes", strings.Replace(privatePerimeterFixture, `"routes":`, `"Routes":`, 1)},
		{"case ambiguous HTTPS server", strings.Replace(privatePerimeterFixture, `"servers":`, `"Servers":`, 1)},
		{"case ambiguous HTTP module", strings.Replace(privatePerimeterFixture, `"http":`, `"HTTP":`, 1)},
		{"case ambiguous apps", strings.Replace(privatePerimeterFixture, `"apps":`, `"Apps":`, 1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if privateCaddyIngressPerimeterValid([]byte(tc.raw), current) {
				t.Fatal("untrusted ingress permitted")
			}
		})
	}
}
