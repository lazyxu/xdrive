package api

// photoHostPrivatePolicyObservation is local and read-only. Only four
// trustworthy same-process Info callbacks plus the independently verified
// Host Apply request ACK may publish a limited self-reported policy label.
//
// strict-local is NOT a positive admission/safe-stop capability: the real
// model may still accept calls outside a held PostgreSQL lease, and old
// Server replicas or direct Unix peers are not in this local observation.
func photoHostPrivatePolicyObservation(checks []photoHostModelInfoCheck, ack bool) string {
	if !ack || !photoHostModelInstanceCoherent(checks) {
		return "unverified"
	}
	observed := ""
	for _, check := range checks {
		if check.policy == nil {
			return "unverified"
		}
		policy := *check.policy
		if policy != "legacy" && policy != "require-bearer-v1" {
			return "unverified"
		}
		if policy == "require-bearer-v1" {
			if check.auth == nil {
				// Older model: absence of a private Bearer observation is not
				// evidence of a negative authentication configuration.
				return "unverified"
			}
			if !*check.auth {
				return "inconsistent"
			}
		}
		if observed != "" && observed != policy {
			return "inconsistent"
		}
		observed = policy
	}
	if observed == "require-bearer-v1" {
		return "strict-local"
	}
	if observed == "legacy" {
		return "legacy-local"
	}
	return "unverified"
}
