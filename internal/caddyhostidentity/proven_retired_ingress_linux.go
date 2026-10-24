//go:build linux

package caddyhostidentity

import (
	"context"
	"crypto/x509"
	"path/filepath"
	"time"
)

// Both readers are internal test seams. The production entrypoint below uses
// only the fixed Linux Docker observer and the original Host-only terminal.
// Injected callbacks cannot publish or sign an Applied receipt.
type privateRuntimeAnchorReader func(context.Context) (boundPrivateCaddyRuntime, error)
type privateOriginalRetiredReader func(context.Context, string, privateHostAuthoritySnapshot, boundPrivateCaddyRuntime) (privateRetiredTargets, error)

// privateObserveOriginalRetiredIngressWith binds the ORIGINAL Host success
// operation, current Host .env, saved Caddy generation/live SHA, real TLS
// candidates and route map into one fail-closed PRIVATE candidate. It is NOT
// a continuous Caddy reload/A-B-A fence, trusted network-negative proof,
// signing capability or current Applied result.
func privateObserveOriginalRetiredIngressWith(
	ctx context.Context, operationID string, currentLANRoots, retiredLANRoots *x509.CertPool,
	snapshot privateHostSnapshotReader, running privateRuntimeAnchorReader,
	original privateOriginalRetiredReader, collect privateBoundCandidateRunner,
) (privateIngressTransportCandidates, error) {
	fail := func() (privateIngressTransportCandidates, error) {
		return privateIngressTransportCandidates{}, errUntrusted
	}
	if ctx == nil || ctx.Err() != nil || !validPrivateOperationID(operationID) ||
		snapshot == nil || running == nil || original == nil || collect == nil {
		return fail()
	}
	before, err := snapshot(ctx)
	if err != nil || !validDigest(before.envSHA) || !validDigest(before.fileEpoch) ||
		(before.domain == "" && before.lanIPv4 == "") ||
		(before.domain != "" && !validDomain(before.domain)) ||
		(before.lanIPv4 != "" && !validLANIP(before.lanIPv4)) ||
		(before.lanIPv4 == "" && currentLANRoots != nil) ||
		(before.lanIPv4 != "" && currentLANRoots == nil) {
		return fail()
	}
	pinned, err := running(ctx)
	if err != nil || !validDigest(pinned.instanceSHA) ||
		!validDigest(pinned.generationSHA) || !validDigest(pinned.hostLocalGenerationSHA) ||
		!validDigest(pinned.liveConfigSHA) || pinned.liveConfigSHA == emptySHA256 ||
		ctx.Err() != nil {
		return fail()
	}
	retired, err := original(ctx, operationID, before, pinned)
	if err != nil || ctx.Err() != nil ||
		(retired.domain == "" && retired.lanIPv4 == "") ||
		(retired.domain != "" && (!validDomain(retired.domain) || retired.domain == before.domain)) ||
		(retired.lanIPv4 != "" && (!validLANIP(retired.lanIPv4) || retired.lanIPv4 == before.lanIPv4)) ||
		(retired.lanIPv4 == "" && retiredLANRoots != nil) ||
		(retired.lanIPv4 != "" && retiredLANRoots == nil) ||
		retired.lanRoots != nil {
		return fail()
	}
	// Only the trusted operator-owned prior-LAN root can be attached. Neither
	// the historical record nor the caller's authenticated HTTP session can
	// inject the CA used to validate a retired LAN endpoint.
	retired.lanRoots = retiredLANRoots
	evidence, err := privateObserveHostBoundIngressWith(
		ctx, retired, currentLANRoots, snapshot, collect,
	)
	if err != nil || ctx.Err() != nil ||
		evidence.runtime != pinned || !validDigest(evidence.routeDigest) ||
		(before.domain != "" && !validDigest(evidence.domainReady)) ||
		(before.lanIPv4 != "" && !validDigest(evidence.lanReady)) ||
		(retired.domain != "" && !validDigest(evidence.retiredDomain)) ||
		(retired.lanIPv4 != "" && !validDigest(evidence.retiredLAN)) {
		return fail()
	}
	after, err := snapshot(ctx)
	if err != nil || before != after || ctx.Err() != nil {
		return fail()
	}
	return evidence, nil
}

// The production reader obtains its only current-target input from the
// operator-owned, locked local Host .env, and its only historical-target input
// from the original immutable Host Deploy + private retired-target record.
// A customized Host bridge layout currently remains unsupported/fail-closed.
// No HTTP, Agent, DB Desired, generic Docker, credentials or signing API.
func privateObserveOriginalHostIngressCandidates(
	ctx context.Context, hostHome, operationID string,
	currentLANRoots, retiredLANRoots *x509.CertPool,
) (privateIngressTransportCandidates, error) {
	if ctx == nil || ctx.Err() != nil || hostHome == "" || !filepath.IsAbs(hostHome) ||
		filepath.Clean(hostHome) != hostHome || !validPrivateOperationID(operationID) {
		return privateIngressTransportCandidates{}, errUntrusted
	}
	readHost := func(readCtx context.Context) (privateHostAuthoritySnapshot, error) {
		raw, epoch, err := privateRunFencedHostSnapshot(readCtx, hostHome)
		if err != nil {
			return privateHostAuthoritySnapshot{}, errUntrusted
		}
		defer clear(raw)
		record, err := privateDecodeAuthoritativeHostSnapshot(raw, time.Now().UTC())
		if err != nil || !validDigest(epoch) {
			return privateHostAuthoritySnapshot{}, errUntrusted
		}
		record.fileEpoch = epoch
		return record, nil
	}
	readRunning := func(readCtx context.Context) (boundPrivateCaddyRuntime, error) {
		sample, err := privateReadCaddyRuntimeSample(readCtx, runPrivateFixedDockerSample)
		if err != nil {
			return boundPrivateCaddyRuntime{}, errUntrusted
		}
		// The single preflight sample is only a historical-generation
		// comparison anchor. The full collector separately takes a bounded
		// before/probe/after runtime window and requires exact equality.
		return bindPrivateCaddyRuntimeWindow(sample, sample, time.Now().UTC())
	}
	bridge := filepath.Join(hostHome, "state", "control")
	readOriginal := func(readCtx context.Context, id string, source privateHostAuthoritySnapshot,
		active boundPrivateCaddyRuntime,
	) (privateRetiredTargets, error) {
		if readCtx.Err() != nil {
			return privateRetiredTargets{}, errUntrusted
		}
		return privateReadHostRetiredTargets(
			bridge, id, source, active.hostLocalGenerationSHA,
			active.liveConfigSHA, time.Now().UTC(),
		)
	}
	return privateObserveWithCaddyReloadCheckpoint(
		ctx, privateReadCurrentCaddyReloadEpoch,
		func(checkCtx context.Context) (privateIngressTransportCandidates, error) {
			return privateObserveOriginalRetiredIngressWith(
				checkCtx, operationID, currentLANRoots, retiredLANRoots,
				readHost, readRunning, readOriginal, privateObserveActualHostIngressCandidates,
			)
		},
	)
}
