package caddyhostidentity

import (
	"context"
	"crypto/x509"
	"time"
)

// privateHostRetiredTLSProbe is used only in the package-private, fixed Host
// observer. It must verify a CURRENT Host-authoritative TLS name/IP SAN and
// carry the immutable retired HTTP Host, never resolve the retired address.
type privateHostRetiredTLSProbe func(context.Context, privateHostEnabledTargets, string) (localRetiredOriginCandidate, error)

// A genuine Ready TLS response and a negative HTTP-Host response must not be
// gathered from two different TLS endpoints. Require the same verified peer
// leaf certificate for the SAME current TLS authority in this one bounded
// Host/Docker/config window. This detects several listener/proxy substitution
// cases but does NOT prove the listener belongs to the sampled Caddy PID.
// Test seam is package-private; only the production fixed Docker/Host path
// calls this method, and no evidence can be signed by it.
func privateObserveTLSLeafContinuityWith(
	ctx context.Context, current privateHostEnabledTargets, retired privateRetiredTargets,
	runner privateHostSampleRunner,
	probeDomain privateDomainReadyProbe, probeLAN privateLANReadyProbe,
	probeRetired privateHostRetiredTLSProbe, routeMap privateRouteReader,
	now time.Time,
) (privateIngressTransportCandidates, error) {
	fail := func() (privateIngressTransportCandidates, error) {
		return privateIngressTransportCandidates{}, errUntrusted
	}
	if ctx == nil || ctx.Err() != nil || probeRetired == nil {
		return fail()
	}
	var currentDomainLeaf, currentLANLeaf string
	domainReady := func(probeCtx context.Context, name string) (localTLSReadyEvidence, error) {
		if probeDomain == nil {
			return localTLSReadyEvidence{}, errUntrusted
		}
		proof, err := probeDomain(probeCtx, name)
		if err != nil || !validDigest(proof.digest) || !validDigest(proof.peerLeafSHA) {
			return localTLSReadyEvidence{}, errUntrusted
		}
		currentDomainLeaf = proof.peerLeafSHA
		return proof, nil
	}
	lanReady := func(probeCtx context.Context, ip string, roots *x509.CertPool) (localTLSReadyEvidence, error) {
		if probeLAN == nil {
			return localTLSReadyEvidence{}, errUntrusted
		}
		proof, err := probeLAN(probeCtx, ip, roots)
		if err != nil || !validDigest(proof.digest) || !validDigest(proof.peerLeafSHA) {
			return localTLSReadyEvidence{}, errUntrusted
		}
		currentLANLeaf = proof.peerLeafSHA
		return proof, nil
	}
	retiredCheck := func(probeCtx context.Context, oldHost string) (localRetiredOriginCandidate, error) {
		// The existing ingress window collects enabled positive probes first.
		// A missing positive leaf, wrong leaf, incomplete TLS chain, or an
		// unexpected identity selection MUST invalidate the negative candidate.
		proof, err := probeRetired(probeCtx, current, oldHost)
		expected := currentDomainLeaf
		if privateRetiredUsesLAN(current, oldHost) {
			expected = currentLANLeaf
		}
		if err != nil || !validDigest(proof.digest) ||
			!validDigest(proof.peerLeafSHA) || !validDigest(expected) ||
			proof.peerLeafSHA != expected {
			return localRetiredOriginCandidate{}, errUntrusted
		}
		return proof, nil
	}
	oldDomain := func(probeCtx context.Context, name string) (localRetiredOriginCandidate, error) {
		return retiredCheck(probeCtx, name)
	}
	oldLAN := func(probeCtx context.Context, ip string, _ *x509.CertPool) (localRetiredOriginCandidate, error) {
		return retiredCheck(probeCtx, ip)
	}
	return privateObserveIngressCandidatesWith(ctx, current, retired,
		runner, domainReady, lanReady, oldDomain, oldLAN, routeMap, now)
}
