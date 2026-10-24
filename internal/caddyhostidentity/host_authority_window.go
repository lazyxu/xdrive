package caddyhostidentity

import (
	"context"
	"crypto/x509"
	"time"
)

type privateHostSnapshotReader func(context.Context) (privateHostAuthoritySnapshot, error)
type privateBoundCandidateRunner func(context.Context, privateHostEnabledTargets, privateRetiredTargets) (privateIngressTransportCandidates, error)

// The snapshot and the live TLS/route/window proof are captured from the
// same host twice. An unverified Save, a different current config fingerprint,
// replaced/modified Host .env inode or renamed ingress invalidates the result.
// This detects Host atomic Save A→B→A in normal filesystem conditions, but
// cannot prove Caddy's independent in-memory reload A→B→A absence. It is NOT a
// continuous mutation fence or independent validation of old targets;
// it MUST NOT be used to issue any Applied signature yet.
func privateObserveHostBoundIngressWith(ctx context.Context, retired privateRetiredTargets, roots *x509.CertPool,
	snapshot privateHostSnapshotReader, collect privateBoundCandidateRunner,
) (privateIngressTransportCandidates, error) {
	fail := func() (privateIngressTransportCandidates, error) {
		return privateIngressTransportCandidates{}, errUntrusted
	}
	if ctx == nil || ctx.Err() != nil || snapshot == nil || collect == nil {
		return fail()
	}
	before, err := snapshot(ctx)
	if err != nil || !validDigest(before.envSHA) || !validDigest(before.fileEpoch) ||
		(before.domain == "" && before.lanIPv4 == "") ||
		(before.domain != "" && !validDomain(before.domain)) ||
		(before.lanIPv4 != "" && !validLANIP(before.lanIPv4)) {
		return fail()
	}
	if before.lanIPv4 == "" && roots != nil {
		return fail()
	}
	if before.lanIPv4 != "" && roots == nil {
		return fail()
	}
	current := privateHostEnabledTargets{domain: before.domain, lanIPv4: before.lanIPv4, lanRoots: roots}
	observed, err := collect(ctx, current, retired)
	if err != nil || ctx.Err() != nil {
		return fail()
	}
	after, err := snapshot(ctx)
	if err != nil || before != after || ctx.Err() != nil {
		return fail()
	}
	return observed, nil
}

// Restricted Linux Host path only. hostHome must come from operator-owned
// local configuration, never HTTP/Agent/DB. Old retired targets are still
// caller-owned candidates until independently bound to immutable Host history.
func privateObserveHostBoundIngressCandidates(ctx context.Context, hostHome string,
	retired privateRetiredTargets, roots *x509.CertPool,
) (privateIngressTransportCandidates, error) {
	read := func(ctx context.Context) (privateHostAuthoritySnapshot, error) {
		raw, epoch, err := privateRunFencedHostSnapshot(ctx, hostHome)
		if err != nil {
			return privateHostAuthoritySnapshot{}, errUntrusted
		}
		defer clear(raw)
		snapshot, err := privateDecodeAuthoritativeHostSnapshot(raw, time.Now().UTC())
		if err != nil || !validDigest(epoch) {
			return privateHostAuthoritySnapshot{}, errUntrusted
		}
		snapshot.fileEpoch = epoch
		return snapshot, nil
	}
	return privateObserveHostBoundIngressWith(ctx, retired, roots, read,
		privateObserveActualHostIngressCandidates)
}
