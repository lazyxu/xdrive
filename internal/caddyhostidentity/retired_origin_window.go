package caddyhostidentity

import (
	"context"
	"crypto/x509"
	"time"
)

// Reuse privateRetiredTargets from the existing Host-only route checker.
type privateRetiredProbe func(context.Context, string) (localRetiredOriginCandidate, error)
type privateRetiredLANProbe func(context.Context, string, *x509.CertPool) (localRetiredOriginCandidate, error)
type privateRouteReader func(context.Context) ([]byte, error)

// privateIngressTransportCandidates combines genuine positive TLS/Ready and
// bounded retired-origin transport candidates in ONE before/after Caddy
// generation and live config window. Unexported digests cannot be serialized
// to admin UI or used by the existing Applied signer without independent
// route-absence, Host source, key and continuous-mutation validation.
type privateIngressTransportCandidates struct {
	publishedOwnerDigest   string
	runtime                boundPrivateCaddyRuntime
	domainReady            string
	lanReady               string
	retiredDomain          string
	retiredLAN             string
	routeDigest            string
	reloadCheckpointDigest string
}

// Test seams permit synthetic local TLS and fake read-only Docker inspection.
// A strictly parsed live route map is required in the same sampled window.
// This still cannot issue a signed Applied receipt without a trusted immutable
// earlier Host target source and a continuous Caddy mutation fence.
func privateObserveIngressCandidatesWith(ctx context.Context,
	current privateHostEnabledTargets, retired privateRetiredTargets,
	runner privateHostSampleRunner,
	domainReady privateDomainReadyProbe, lanReady privateLANReadyProbe,
	retiredDomain privateRetiredProbe, retiredLAN privateRetiredLANProbe,
	readRouteMap privateRouteReader, now time.Time,
) (privateIngressTransportCandidates, error) {
	fail := func() (privateIngressTransportCandidates, error) {
		return privateIngressTransportCandidates{}, errUntrusted
	}
	if ctx == nil || ctx.Err() != nil || runner == nil || readRouteMap == nil || now.IsZero() {
		return fail()
	}
	hasDomain, hasLAN := current.domain != "", current.lanIPv4 != ""
	oldDomain, oldLAN := retired.domain != "", retired.lanIPv4 != ""
	if (!hasDomain && !hasLAN) || (!oldDomain && !oldLAN) ||
		(hasDomain && (!validDomain(current.domain) || domainReady == nil)) ||
		(hasLAN && (!validLANIP(current.lanIPv4) || current.lanRoots == nil || lanReady == nil)) ||
		(!hasLAN && current.lanRoots != nil) ||
		(oldDomain && (!validDomain(retired.domain) || retiredDomain == nil)) ||
		(oldLAN && (!validLANIP(retired.lanIPv4) || retired.lanRoots == nil || retiredLAN == nil)) ||
		(!oldLAN && retired.lanRoots != nil) ||
		(oldDomain && current.domain == retired.domain) ||
		(oldLAN && current.lanIPv4 == retired.lanIPv4) {
		return fail()
	}
	var candidate privateIngressTransportCandidates
	var activeRouteRaw []byte
	defer func() { clear(activeRouteRaw) }()
	window, err := privateObserveStableCaddyWindow(ctx, runner, func(probeCtx context.Context) error {
		if hasDomain {
			p, e := domainReady(probeCtx, current.domain)
			if e != nil || !validDigest(p.digest) {
				return errUntrusted
			}
			candidate.domainReady = p.digest
		}
		if hasLAN {
			p, e := lanReady(probeCtx, current.lanIPv4, current.lanRoots)
			if e != nil || !validDigest(p.digest) {
				return errUntrusted
			}
			candidate.lanReady = p.digest
		}
		if oldDomain {
			p, e := retiredDomain(probeCtx, retired.domain)
			if e != nil || !validDigest(p.digest) {
				return errUntrusted
			}
			candidate.retiredDomain = p.digest
		}
		if oldLAN {
			p, e := retiredLAN(probeCtx, retired.lanIPv4, retired.lanRoots)
			if e != nil || !validDigest(p.digest) {
				return errUntrusted
			}
			candidate.retiredLAN = p.digest
		}
		if probeCtx.Err() != nil {
			return errUntrusted
		}
		routeRaw, readErr := readRouteMap(probeCtx)
		if readErr != nil || len(routeRaw) == 0 || len(routeRaw) > maxHostPrivateRouteJSON {
			clear(routeRaw)
			return errUntrusted
		}
		activeRouteRaw = routeRaw
		return nil
	}, now)
	if err != nil || ctx.Err() != nil {
		return fail()
	}
	candidate.runtime = window
	verified, verifyErr := privateVerifyRetiredRouteAbsent(activeRouteRaw, window.liveConfigSHA, current, retired)
	if verifyErr != nil || !validDigest(verified.digest) {
		return fail()
	}
	candidate.routeDigest = verified.digest
	return candidate, nil
}

// Private production path only. This collects actual Host-local TLS, Caddy
// generation, live config bytes and bounded route evidence; it does not read
// arbitrary web input, load signing keys, claim WAN reachability or publish
// an Applied result. Old targets remain caller-owned and MUST be authenticated
// from a historical immutable Host proof by the future independent Collector.
func privateObserveActualHostIngressCandidates(ctx context.Context,
	current privateHostEnabledTargets, retired privateRetiredTargets,
) (privateIngressTransportCandidates, error) {
	// A decommissioned hostname may no longer have a certificate, so an old
	// SNI + old HTTP Host verified-421 cannot be the production negative gate.
	// Instead verify the CURRENT Host's TLS chain/IP SAN while deliberately
	// sending the ORIGINAL retired HTTP Host. A native 404 is merely a
	// transport candidate: the live Caddy routes, Host source, runtime
	// fences and the enabled/retired TLS leaf certificates MUST all match
	// before returning a private digest.
	return privateObservePublishedOwnerWith(ctx, current, privateReadFixedCaddyPublishedOwner,
		func(observeCtx context.Context) (privateIngressTransportCandidates, error) {
			return privateObserveTLSLeafContinuityWith(observeCtx, current, retired,
				runPrivateFixedDockerSample, probeCaddyDomainReady, probeCaddyLANReady,
				privateProbeNativeRetiredHost, runPrivateCaddyRouteSample, time.Now().UTC())
		})
}
