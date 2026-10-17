package main

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// sealLocalBoundFirstDirectoryAdvisory binds the already-private native check
// to one Server-issued advisory challenge. Both bound reads must agree BEFORE
// any seal is returned. A valid seal is NOT a native-handle lifetime guarantee
// or permission to create a cloud Node/SourceItem.
// sealLocalBoundFirstDirectoryAdvisory preserves the existing PRIVATE test
// API. Its injected reader is the legacy non-held observation path.
func sealLocalBoundFirstDirectoryAdvisory(
	ctx context.Context, sourceID uint64,
	request localpush.LocalFirstDirectoryNativeRecheckRequest,
	challenge localpush.LocalFirstDirectoryAdvisoryChallenge,
	readBound localFirstDirectoryBoundReader,
	readNative localFirstDirectoryNativeReader,
) (localpush.LocalFirstDirectoryAdvisorySeal, error) {
	if readNative == nil {
		return localpush.LocalFirstDirectoryAdvisorySeal{}, privateLocalFirstDirectoryBoundError(nil)
	}
	return sealLocalBoundFirstDirectoryAdvisoryHeld(ctx, sourceID, request,
		challenge, readBound,
		func(ctx context.Context, proof client.LocalBoundSourceProof,
			req localpush.LocalFirstDirectoryNativeRecheckRequest,
			checkpoint func(context.Context, localpush.LocalFirstDirectoryNativeObservation) error,
		) (localpush.LocalFirstDirectoryNativeObservation, error) {
			observed, err := readNative(ctx, proof, req)
			if err != nil {
				return localpush.LocalFirstDirectoryNativeObservation{}, err
			}
			if err := checkpoint(ctx, observed); err != nil {
				return localpush.LocalFirstDirectoryNativeObservation{}, err
			}
			return observed, nil
		},
	)
}

// sealLocalBoundFirstDirectoryAdvisoryHeld reads the SAME authentic owning
// Source/Device/Root/Target twice, with the second read performed by the native
// reader's checkpoint while its verified OS handle remains open. This is not
// Server SQL native-handle attestation and must never be treated as commit.
func sealLocalBoundFirstDirectoryAdvisoryHeld(
	ctx context.Context, sourceID uint64,
	request localpush.LocalFirstDirectoryNativeRecheckRequest,
	challenge localpush.LocalFirstDirectoryAdvisoryChallenge,
	readBound localFirstDirectoryBoundReader,
	readNativeHeld localFirstDirectoryNativeHeldReader,
) (localpush.LocalFirstDirectoryAdvisorySeal, error) {
	var empty localpush.LocalFirstDirectoryAdvisorySeal
	deny := func(err error) (localpush.LocalFirstDirectoryAdvisorySeal, error) {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	if ctx == nil || sourceID == 0 || challenge.OwnerID == 0 ||
		challenge.SourceID != sourceID ||
		challenge.SourceRevision != request.SourceRevision ||
		readBound == nil || readNativeHeld == nil {
		return deny(nil)
	}
	if err := ctx.Err(); err != nil {
		return deny(err)
	}
	var finalProof client.LocalBoundSourceProof
	observed, err := observeLocalBoundFirstDirectoryHeld(
		ctx, sourceID, request,
		func(ctx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
			source, proof, err := readBound(ctx, id)
			if err != nil || !validBoundFirstDirectorySource(source, proof, sourceID) ||
				source.Revision != challenge.SourceRevision ||
				source.TargetNodeID == nil || *source.TargetNodeID != challenge.TargetNodeID ||
				proof.DeviceID != challenge.DeviceID || proof.RootID != challenge.RootID ||
				proof.RootFingerprint != challenge.RootFingerprint {
				return client.Source{}, client.LocalBoundSourceProof{}, privateLocalFirstDirectoryBoundError(err)
			}
			finalProof = proof
			return source, proof, nil
		},
		readNativeHeld,
	)
	if err != nil {
		return deny(err)
	}
	if err := ctx.Err(); err != nil {
		return deny(err)
	}
	sealed, err := localpush.SealLocalFirstDirectoryAdvisoryObservation(
		ctx, observed, challenge, finalProof.DeviceToken, time.Now().UTC(),
	)
	if err != nil {
		return deny(err)
	}
	if err := ctx.Err(); err != nil {
		return deny(err)
	}
	return sealed, nil
}

// sealOwnLocalBoundBackupFirstDirectoryNative is Agent-private. It is NOT
// registered in Agent HTTP/IPC, Electron Main/Preload, Web, or a scheduler.
// There is deliberately no Server challenge transport or commit consumer.
// An on-disk Root can be replaced immediately after this read.
func (c *agentController) sealOwnLocalBoundBackupFirstDirectoryNative(
	ctx context.Context, sourceID uint64,
	request localpush.LocalFirstDirectoryNativeRecheckRequest,
	challenge localpush.LocalFirstDirectoryAdvisoryChallenge,
) (localpush.LocalFirstDirectoryAdvisorySeal, error) {
	var empty localpush.LocalFirstDirectoryAdvisorySeal
	if c == nil || ctx == nil || sourceID == 0 || request.SourceID != sourceID ||
		challenge.SourceID != sourceID {
		return empty, privateLocalFirstDirectoryBoundError(nil)
	}
	if !c.localFolderGrantMu.TryLock() {
		return empty, privateLocalFirstDirectoryBoundError(nil)
	}
	defer c.localFolderGrantMu.Unlock()

	readCtx, cancel := context.WithTimeout(ctx, 100*time.Second)
	defer cancel()
	account, err := userconfig.Load()
	if err != nil {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	sealed, err := sealLocalBoundFirstDirectoryAdvisoryHeld(
		readCtx, sourceID, request, challenge,
		func(ctx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
			source, proof, _, err := c.localBoundBackupConfig(ctx, id)
			return source, proof, err
		},
		func(ctx context.Context, proof client.LocalBoundSourceProof,
			request localpush.LocalFirstDirectoryNativeRecheckRequest,
			checkpoint func(context.Context, localpush.LocalFirstDirectoryNativeObservation) error,
		) (localpush.LocalFirstDirectoryNativeObservation, error) {
			grant, err := localpush.LoadRootGrant(configDir, account.Server, account.Username, proof.RootID)
			if err != nil || grant.SourceID != sourceID ||
				grant.DeviceID != proof.DeviceID || grant.RootID != proof.RootID ||
				grant.Fingerprint != proof.RootFingerprint || !grant.StrongIdentity ||
				grant.Server != account.Server || grant.Account != account.Username {
				return localpush.LocalFirstDirectoryNativeObservation{}, privateLocalFirstDirectoryBoundError(err)
			}
			return localpush.RecheckLocalFirstDirectoryNativeWithHeldCheckpoint(ctx, configDir, grant, request, checkpoint)
		},
	)
	if err != nil {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	if err := localBackupRuleSessionUnchanged(account); err != nil {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	if err := readCtx.Err(); err != nil {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	return sealed, nil
}
