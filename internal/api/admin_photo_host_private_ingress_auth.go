package api

// The existing administrator-triggered Photo Host preflight emits only a
// NEGATIVE model-private Bearer observation. No "safe" or "verified" output is
// possible: configured tokens are not a cross-instance admission fence.
func photoHostPrivateIngressAuthBlockerState(
	serverTokenConfigured bool,
	modelConfigured bool,
	checks []photoHostModelInfoCheck,
) string {
	if modelConfigured && !serverTokenConfigured {
		return "blocked"
	}
	for _, check := range checks {
		if check.State == "ready" && check.auth != nil && !*check.auth {
			return "blocked"
		}
	}
	return "unverified"
}
