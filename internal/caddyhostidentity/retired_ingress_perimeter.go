package caddyhostidentity

import (
	"bytes"
	"encoding/json"
	"strings"
)

// privateCaddyIngressPerimeterValid checks for alternate HTTP/TLS ingress
// semantics that a top-level HTTP host-route inventory cannot account for.
// It is ONLY a conservative precondition for a private route-absence candidate.
// This is not a live network-negative attestation or an Applied receipt.
func privateCaddyIngressPerimeterValid(raw []byte, current privateHostEnabledTargets) bool {
	var root map[string]json.RawMessage
	if json.Unmarshal(raw, &root) != nil || !privateCanonicalKeys(root, "apps") {
		return false
	}
	apps, ok := privateJSONMap(root["apps"])
	if !ok || !privateCanonicalKeys(apps, "http", "tls", "pki", "events") {
		return false
	}
	httpApp, ok := privateJSONMap(apps["http"])
	if !ok || !privateCanonicalKeys(httpApp, "servers") {
		return false
	}
	servers, ok := privateJSONMap(httpApp["servers"])
	if !ok || len(servers) == 0 {
		return false
	}
	for _, rawServer := range servers {
		server, ok := privateJSONMap(rawServer)
		if !ok || !privateCanonicalKeys(server,
			"listen", "routes", "errors", "named_routes",
			"listener_wrappers", "tls_connection_policies") {
			return false
		}
		if _, ok := server["listen"]; !ok {
			return false
		}
		if _, ok := server["routes"]; !ok {
			return false
		}
		// Named/error routes may invoke an otherwise invisible backend route.
		// Listener wrappers can install a separate TLS/proxy entry before the
		// HTTP route map. Unknown ones must not satisfy a retired-host proof.
		for _, key := range []string{"errors", "named_routes", "listener_wrappers"} {
			if _, present := server[key]; present {
				return false
			}
		}
		policiesRaw, present := server["tls_connection_policies"]
		if !present {
			continue
		}
		var policies []json.RawMessage
		if json.Unmarshal(policiesRaw, &policies) != nil || policies == nil {
			return false
		}
		for _, rawPolicy := range policies {
			policy, ok := privateJSONMap(rawPolicy)
			if !ok || !privateCanonicalKeys(policy,
				"default_sni", "fallback_sni", "match") {
				return false
			}
			// Fallback SNI can serve a different TLS identity after a former
			// SNI was retired, bypassing a straightforward host-route check.
			if _, present := policy["fallback_sni"]; present {
				return false
			}
			if identity, present := policy["default_sni"]; present {
				var name string
				if json.Unmarshal(identity, &name) != nil || name == "" ||
					name != current.domain && name != current.lanIPv4 {
					return false
				}
			}
			if match, present := policy["match"]; present {
				matchers, ok := privateJSONMap(match)
				if !ok || len(matchers) != 1 || !privateCanonicalKeys(matchers, "sni") {
					return false
				}
				var names []string
				if json.Unmarshal(matchers["sni"], &names) != nil || len(names) == 0 {
					return false
				}
				for _, name := range names {
					if name == "" || name != current.domain && name != current.lanIPv4 {
						return false
					}
				}
			}
		}
	}
	return true
}

func privateJSONMap(raw []byte) (map[string]json.RawMessage, bool) {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, false
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil || obj == nil {
		return nil, false
	}
	return obj, true
}

// encoding/json matches struct fields case-insensitively, unlike explicit
// Caddy module names/paths. Refuse near-key aliases so independent parsers
// cannot silently disagree about which live routing branch was verified.
func privateCanonicalKeys(obj map[string]json.RawMessage, expected ...string) bool {
	for key := range obj {
		for _, canonical := range expected {
			if strings.EqualFold(key, canonical) && key != canonical {
				return false
			}
		}
	}
	return true
}
