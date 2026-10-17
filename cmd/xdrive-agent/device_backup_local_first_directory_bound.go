package main

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// These injected readers exercise an Agent-private preflight, never a commit.
type localFirstDirectoryBoundReader func(context.Context, uint64) (client.Source, client.LocalBoundSourceProof, error)
type localFirstDirectoryNativeReader func(context.Context, client.LocalBoundSourceProof, localpush.LocalFirstDirectoryNativeRecheckRequest) (localpush.LocalFirstDirectoryNativeObservation, error)

// A held native reader MUST invoke checkpoint exactly once while its local OS
// directory handle is still open; it grants no Server write authority.
type localFirstDirectoryNativeHeldReader func(context.Context, client.LocalBoundSourceProof, localpush.LocalFirstDirectoryNativeRecheckRequest, func(context.Context, localpush.LocalFirstDirectoryNativeObservation) error) (localpush.LocalFirstDirectoryNativeObservation, error)

func privateLocalFirstDirectoryBoundError(err error) error {
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	// Do not relay physical paths, tokens or raw Server errors through IPC.
	return errors.New("owning first-directory observation unavailable")
}

func validBoundFirstDirectorySource(source client.Source, proof client.LocalBoundSourceProof, id uint64) bool {
	return id != 0 && source.ID == id && source.Revision != 0 &&
		source.Kind == meta.SourceKindLocalFolder &&
		source.Direction == meta.SourceDirectionPush &&
		source.Status == meta.SourceStatusPaused &&
		source.TargetNodeID != nil && *source.TargetNodeID != 0 &&
		proof.DeviceID != "" && proof.DeviceToken != "" &&
		proof.RootID != "" && len(proof.RootFingerprint) == 64
}

func sameBoundFirstDirectorySource(a, b client.Source) bool {
	return a.ID == b.ID && a.Revision == b.Revision &&
		a.Kind == b.Kind && a.Direction == b.Direction &&
		a.Status == b.Status && a.Name == b.Name &&
		a.SyncMode == b.SyncMode && a.RunMode == b.RunMode &&
		a.TargetNodeID != nil && b.TargetNodeID != nil &&
		*a.TargetNodeID == *b.TargetNodeID &&
		a.TargetPath == b.TargetPath && a.IgnoreRules == b.IgnoreRules &&
		a.ScheduleType == b.ScheduleType &&
		a.ScheduleExpression == b.ScheduleExpression &&
		a.ScheduleTimezone == b.ScheduleTimezone
}

// Observe owning Server scope, one genuine native CURRENT directory, and the
// Server scope AGAIN. Neither this ordering nor the native double stat pins
// native OS handles across PostgreSQL; positive results are NOT commit tokens.
// observeLocalBoundFirstDirectory keeps the old Agent-private injected
// reader/test contract. That legacy reader returns an observation after its
// local OS handle closes; it is NOT a held Server-checkpoint protocol.
func observeLocalBoundFirstDirectory(
	ctx context.Context, sourceID uint64,
	request localpush.LocalFirstDirectoryNativeRecheckRequest,
	readBound localFirstDirectoryBoundReader,
	readNative localFirstDirectoryNativeReader,
) (localpush.LocalFirstDirectoryNativeObservation, error) {
	if readNative == nil {
		return localpush.LocalFirstDirectoryNativeObservation{}, privateLocalFirstDirectoryBoundError(nil)
	}
	return observeLocalBoundFirstDirectoryHeld(ctx, sourceID, request, readBound,
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

// observeLocalBoundFirstDirectoryHeld requires the second authenticated
// Server read to run inside the Agent's opened native directory callback.
// A fabricated reader that omits, duplicates or alters this checkpoint fails
// closed. This is only read-only preflight, NOT a native/SQL transaction lease.
func observeLocalBoundFirstDirectoryHeld(
	ctx context.Context, sourceID uint64,
	request localpush.LocalFirstDirectoryNativeRecheckRequest,
	readBound localFirstDirectoryBoundReader,
	readNativeHeld localFirstDirectoryNativeHeldReader,
) (localpush.LocalFirstDirectoryNativeObservation, error) {
	var empty localpush.LocalFirstDirectoryNativeObservation
	deny := func(err error) (localpush.LocalFirstDirectoryNativeObservation, error) {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	if ctx == nil || sourceID == 0 || request.SourceID != sourceID ||
		request.SourceRevision == 0 || request.RelativeDirectory == "" ||
		len(request.RelativeDirectory) > 255 ||
		strings.TrimSpace(request.RelativeDirectory) != request.RelativeDirectory ||
		strings.ContainsAny(request.RelativeDirectory, "/\\:\x00\r\n") ||
		readBound == nil || readNativeHeld == nil {
		return deny(nil)
	}
	if err := ctx.Err(); err != nil {
		return deny(err)
	}
	before, proof, err := readBound(ctx, sourceID)
	if err != nil || !validBoundFirstDirectorySource(before, proof, sourceID) ||
		request.SourceRevision != before.Revision {
		return deny(err)
	}
	pathKey, err := localpush.LocalInventoryPathKey(
		localpush.RootGrant{SourceID: sourceID, RootID: proof.RootID},
		"directory", request.RelativeDirectory,
	)
	if err != nil {
		return deny(err)
	}
	if err := ctx.Err(); err != nil {
		return deny(err)
	}
	var checkpoints int
	var checkpointed localpush.LocalFirstDirectoryNativeObservation
	native, err := readNativeHeld(ctx, proof, request,
		func(checkCtx context.Context, candidate localpush.LocalFirstDirectoryNativeObservation) error {
			checkpoints++
			if checkpoints != 1 || checkCtx == nil {
				return privateLocalFirstDirectoryBoundError(nil)
			}
			if err := checkCtx.Err(); err != nil {
				return err
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			// Do not make the SECOND Server request using unverified native
			// metadata. The current OS directory must first match exact Root,
			// generation, target and native item identity with no write claims.
			if !candidate.NativeObserved || candidate.BackupComplete ||
				candidate.CommitSupported || candidate.Authoritative ||
				candidate.MissingInferenceSafe ||
				candidate.SourceID != sourceID ||
				candidate.SourceRevision != before.Revision ||
				candidate.DeviceID != proof.DeviceID ||
				candidate.RootID != proof.RootID ||
				candidate.RelativeDirectory != request.RelativeDirectory ||
				candidate.CurrentPathKey != pathKey ||
				candidate.NativeIdentityKey != request.ExpectedNativeIdentityKey ||
				candidate.PreviousSnapshotSHA256 != request.PreviousSnapshotSHA256 ||
				candidate.CurrentSnapshotSHA256 != request.CurrentSnapshotSHA256 {
				return privateLocalFirstDirectoryBoundError(nil)
			}
			// This authenticated re-read occurs DURING the real Agent's
			// held native directory window, not after closing the handle.
			after, againProof, err := readBound(checkCtx, sourceID)
			if err != nil || !validBoundFirstDirectorySource(after, againProof, sourceID) ||
				againProof != proof || !sameBoundFirstDirectorySource(before, after) {
				return privateLocalFirstDirectoryBoundError(err)
			}
			if err := checkCtx.Err(); err != nil {
				return err
			}
			checkpointed = candidate
			return nil
		})
	if err != nil {
		return deny(err)
	}
	if checkpoints != 1 || native != checkpointed {
		return deny(nil)
	}
	if err := ctx.Err(); err != nil {
		return deny(err)
	}
	return native, nil
}

// Never exposed by Agent IPC, Desktop, Web, startup, background schedule or
// any Server Router. No production writer can consume this ephemeral read.
func (c *agentController) inspectLocalBoundBackupFirstDirectoryNative(
	ctx context.Context, sourceID uint64,
	request localpush.LocalFirstDirectoryNativeRecheckRequest,
) (localpush.LocalFirstDirectoryNativeObservation, error) {
	var empty localpush.LocalFirstDirectoryNativeObservation
	if c == nil || ctx == nil || sourceID == 0 || request.SourceID != sourceID {
		return empty, privateLocalFirstDirectoryBoundError(nil)
	}
	if !c.localFolderGrantMu.TryLock() {
		return empty, privateLocalFirstDirectoryBoundError(nil)
	}
	defer c.localFolderGrantMu.Unlock()
	readCtx, cancel := context.WithTimeout(ctx, 150*time.Second)
	defer cancel()
	account, err := userconfig.Load()
	if err != nil {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	observed, err := observeLocalBoundFirstDirectoryHeld(
		readCtx, sourceID, request,
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
	return observed, nil
}
