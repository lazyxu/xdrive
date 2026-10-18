package api

// Comparing an administrator's saved LAN entry to a fresh fixed-host IP SAN
// observation is read-only, and never a revision-bound Host Manager apply
// receipt or proof of another device's CA trust or LAN/WAN reachability.
func caddyDesiredLANLocalMatch(
	desired adminCaddyHTTPSDesired, host caddyHostStatus, observed bool, deployedIP string,
) string {
	if desired.Revision == 0 || !observed || host.State != "healthy" ||
		caddyLANLocalEffectState(host, observed, deployedIP) != "verified" {
		return "unverified"
	}
	// A locally confirmed enabled IP can contradict a saved disable intent.
	// Absence of TLS proof, by contrast, NEVER proves the port is closed.
	if !desired.LANEnabled {
		return "mismatch-local"
	}
	if !validCaddyLANIP(desired.LANIP) {
		return "unverified"
	}
	if desired.LANIP == deployedIP {
		return "matched-local"
	}
	return "mismatch-local"
}

// Apply is still forbidden. This merely augments the existing domain-only
// removal/switch advisory with an independently verified LAN ingress warning.
// It cannot certify that an unobserved replacement will accept admin login.
func caddyIngressChangeRiskDual(
	desired adminCaddyHTTPSDesired, host caddyHostStatus, observed bool, deployedIP string,
) string {
	if existing := caddyIngressChangeRisk(desired, host, observed); existing != "unverified" {
		return existing
	}
	if desired.Revision == 0 ||
		caddyLANLocalEffectState(host, observed, deployedIP) != "verified" {
		return "unverified"
	}
	if !desired.LANEnabled {
		return "local-lan-removal"
	}
	if caddyDesiredLANLocalMatch(desired, host, observed, deployedIP) == "mismatch-local" {
		return "local-lan-switch"
	}
	return "unverified"
}
