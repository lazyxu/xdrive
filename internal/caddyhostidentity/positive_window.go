package caddyhostidentity

import (
	"context"
	"crypto/x509"
	"time"
)

// privateHostEnabledTargets must be obtained from an independently trusted
// Host-owned configuration, never DB Desired, imported hints or browser data.
// This type is unexported, but the caller's provenance is NOT proven by type.
type privateHostEnabledTargets struct {
	domain   string
	lanIPv4  string
	lanRoots *x509.CertPool
}

// Only positive, enabled, locally verified TLS/Ready evidence is represented.
// A missing digest NEVER proves a disabled entry is unavailable. This result
// cannot sign, adopt, apply, issue a receipt or assert WAN/client reachability.
type privateHostPositiveOnly struct {
	runtime      boundPrivateCaddyRuntime
	domainDigest string
	lanDigest    string
}

type privateDomainReadyProbe func(context.Context, string) (localTLSReadyEvidence, error)
type privateLANReadyProbe func(context.Context, string, *x509.CertPool) (localTLSReadyEvidence, error)

// Tests can inject same-process runners; the production wrapper uses only the
// fixed Host-private Docker observer and actual pinned TLS/Ready probes.
// A successful injected callback is not an independent external Host proof.
func privateObserveEnabledIngressWith(ctx context.Context, targets privateHostEnabledTargets,
	runner privateHostSampleRunner, domainProbe privateDomainReadyProbe,
	lanProbe privateLANReadyProbe, now time.Time,
) (privateHostPositiveOnly, error) {
	fail := func() (privateHostPositiveOnly, error) { return privateHostPositiveOnly{}, errUntrusted }
	if ctx == nil || ctx.Err() != nil || runner == nil || now.IsZero() {
		return fail()
	}
	hasDomain, hasLAN := targets.domain != "", targets.lanIPv4 != ""
	if (!hasDomain && !hasLAN) || (hasDomain && (!validDomain(targets.domain) || domainProbe == nil)) ||
		(hasLAN && (!validLANIP(targets.lanIPv4) || targets.lanRoots == nil || lanProbe == nil)) ||
		(!hasLAN && targets.lanRoots != nil) {
		return fail()
	}
	var domainDigest, lanDigest string
	window, err := privateObserveStableCaddyWindow(ctx, runner, func(probeCtx context.Context) error {
		if hasDomain {
			proof, probeErr := domainProbe(probeCtx, targets.domain)
			if probeErr != nil || !validDigest(proof.digest) || probeCtx.Err() != nil {
				return errUntrusted
			}
			domainDigest = proof.digest
		}
		if hasLAN {
			proof, probeErr := lanProbe(probeCtx, targets.lanIPv4, targets.lanRoots)
			if probeErr != nil || !validDigest(proof.digest) || probeCtx.Err() != nil {
				return errUntrusted
			}
			lanDigest = proof.digest
		}
		return nil
	}, now)
	if err != nil || (hasDomain && !validDigest(domainDigest)) ||
		(hasLAN && !validDigest(lanDigest)) || ctx.Err() != nil {
		return fail()
	}
	return privateHostPositiveOnly{runtime: window, domainDigest: domainDigest, lanDigest: lanDigest}, nil
}

// Default production wiring. It cannot be invoked from a public endpoint or
// use caller-defined Docker commands. There is deliberately no Host signer,
// negative-origin observer, Server consumer or Apply code in this path.
func privateObserveHostEnabledIngress(ctx context.Context, targets privateHostEnabledTargets) (privateHostPositiveOnly, error) {
	return privateObserveEnabledIngressWith(ctx, targets, runPrivateFixedDockerSample,
		probeCaddyDomainReady, probeCaddyLANReady, time.Now().UTC())
}
