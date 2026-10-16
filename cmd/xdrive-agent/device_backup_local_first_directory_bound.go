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
func observeLocalBoundFirstDirectory(
	ctx context.Context, sourceID uint64,
	request localpush.LocalFirstDirectoryNativeRecheckRequest,
	readBound localFirstDirectoryBoundReader,
	readNative localFirstDirectoryNativeReader,
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
		readBound == nil || readNative == nil {
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
	native, err := readNative(ctx, proof, request)
	if err != nil {
		return deny(err)
	}
	if err := ctx.Err(); err != nil {
		return deny(err)
	}
	if !native.NativeObserved || native.BackupComplete || native.CommitSupported ||
		native.Authoritative || native.MissingInferenceSafe ||
		native.SourceID != sourceID || native.SourceRevision != before.Revision ||
		native.DeviceID != proof.DeviceID || native.RootID != proof.RootID ||
		native.RelativeDirectory != request.RelativeDirectory ||
		native.CurrentPathKey != pathKey ||
		native.NativeIdentityKey != request.ExpectedNativeIdentityKey ||
		native.PreviousSnapshotSHA256 != request.PreviousSnapshotSHA256 ||
		native.CurrentSnapshotSHA256 != request.CurrentSnapshotSHA256 {
		return deny(nil)
	}
	after, againProof, err := readBound(ctx, sourceID)
	if err != nil || !validBoundFirstDirectorySource(after, againProof, sourceID) ||
		againProof != proof || !sameBoundFirstDirectorySource(before, after) {
		return deny(err)
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
	observed, err := observeLocalBoundFirstDirectory(
		readCtx, sourceID, request,
		func(ctx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
			source, proof, _, err := c.localBoundBackupConfig(ctx, id)
			return source, proof, err
		},
		func(ctx context.Context, proof client.LocalBoundSourceProof, request localpush.LocalFirstDirectoryNativeRecheckRequest) (localpush.LocalFirstDirectoryNativeObservation, error) {
			grant, err := localpush.LoadRootGrant(configDir, account.Server, account.Username, proof.RootID)
			if err != nil || grant.SourceID != sourceID ||
				grant.DeviceID != proof.DeviceID || grant.RootID != proof.RootID ||
				grant.Fingerprint != proof.RootFingerprint || !grant.StrongIdentity ||
				grant.Server != account.Server || grant.Account != account.Username {
				return localpush.LocalFirstDirectoryNativeObservation{}, privateLocalFirstDirectoryBoundError(err)
			}
			return localpush.RecheckLocalFirstDirectoryNative(ctx, configDir, grant, request)
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
