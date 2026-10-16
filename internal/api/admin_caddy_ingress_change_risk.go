package api

// caddyIngressChangeRisk is advisory ONLY. It describes a locally observed
// HTTPS continuity hazard if a saved desired intent were ever deployed. It
// is never a prerequisite approval, a desired-revision receipt, a public
// reachability claim or permission to touch the ingress container.
func caddyIngressChangeRisk(
	desired adminCaddyHTTPSDesired, host caddyHostStatus, observed bool,
) string {
	if desired.Revision == 0 || !observed || host.State != "healthy" ||
		!host.HTTPSConfigured || !host.TLSCheckSupported || host.TLSState != "verified" {
		return "unverified"
	}
	if !desired.Enabled {
		// Turning off HTTPS could remove the currently verified local TLS
		// access path; we cannot infer whether a separate safe ingress exists.
		return "local-https-removal"
	}
	if caddyDesiredDomainLocalMatch(desired, host, observed) == "mismatch-local" {
		return "local-domain-switch"
	}
	// Even a matching SNI does not prove that applying is safe or that the
	// current desired revision, DNS, TLS, public WAN or rollback works.
	return "unverified"
}
