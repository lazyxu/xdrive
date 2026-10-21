package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushrunner"
	"github.com/lazyxu/xdrive/internal/localpushwriter"
)

// withHistoricalOriginalWriterReadOnly never permits a new upload. A released
// original OS lock is only a local observation: the supplied callback still
// has to replay the exact native file and authenticated SQL/CAS receipt.
// A missing, live, tampered or replaced marker stays uncertain, not retryable.
func withHistoricalOriginalWriterReadOnly(
	ctx context.Context, writerScope localpushwriter.Scope,
	inspect func(context.Context) (localpushrunner.FirstLeafResult, error),
) (localpushrunner.FirstLeafResult, error) {
	uncertain := localpushrunner.FirstLeafResult{Uncertain: true}
	if ctx == nil || ctx.Err() != nil || inspect == nil {
		return uncertain, localpushrunner.ErrUncertain
	}
	var observed localpushrunner.FirstLeafResult
	calls := 0
	err := localpushwriter.WithHeldOriginalWriterObservation(
		ctx, writerScope, func(heldCtx context.Context) error {
			if calls != 0 || heldCtx.Err() != nil {
				return errLocalPushDriverDenied
			}
			calls++
			receipt, readErr := inspect(heldCtx)
			if readErr != nil || !receipt.Confirmed || receipt.Uncertain {
				return errLocalPushDriverDenied
			}
			observed = receipt
			return nil
		})
	if err != nil || ctx.Err() != nil || calls != 1 ||
		!observed.Confirmed || observed.Uncertain {
		return uncertain, localpushrunner.ErrUncertain
	}
	return observed, nil
}

// recoverPreviousFirstLeafWithHeldWriter adds the original durable O_EXCL
// marker's nonblocking kernel lock to the existing *strictly read-only*
// recovery. The outer held ORIGINAL file descriptor supplies the native key:
// no renderer, stale path or stored hash may choose a substitute writer slot.
//
// Lock order: current native descriptor -> original Writer OS lock ->
// authenticated original Operation/Stage/SQL/CAS read -> native post-hash.
// No Stage, operation, key, SQL terminal, retry or SourceRun is created here.
func (d *localPushFirstLeafDriver) recoverPreviousFirstLeafWithHeldWriter(
	ctx context.Context, s localpushrunner.Scope,
) (localpushrunner.FirstLeafResult, error) {
	uncertain := localpushrunner.FirstLeafResult{Uncertain: true}
	if d == nil || ctx == nil || ctx.Err() != nil || s != d.scope ||
		!localPushFirstLeafNameValid(s.RelativePath) || d.bound {
		return uncertain, localpushrunner.ErrUncertain
	}
	evidence, err := d.readPriorFirstLeafOriginalEvidence(ctx, s)
	if err != nil {
		return uncertain, localpushrunner.ErrUncertain
	}
	var observed localpushrunner.FirstLeafResult
	_, err = localpush.WithHeldCurrentOriginalReadCheckpoint(
		ctx, d.configDir, d.grant, evidence.hint.Stage.SnapshotSHA256,
		s.RelativePath, s.ContentSHA256, s.Size,
		func(nativeCtx context.Context, native localpush.NativeHeldCurrentOriginal) error {
			if nativeCtx.Err() != nil ||
				native.SourceID != s.SourceID || native.DeviceID != s.DeviceID ||
				native.RootID != s.RootID || native.RelativePath != s.RelativePath ||
				native.PathKey != evidence.hint.Stage.CurrentPathKey ||
				native.SnapshotSHA256 != evidence.hint.Stage.SnapshotSHA256 ||
				native.ContentSHA256 != s.ContentSHA256 || native.Size != s.Size ||
				native.NativeKey == "" {
				return errLocalPushDriverDenied
			}
			writerScope, scopeErr := localpushwriter.NewScope(
				d.configDir, d.grant.Path,
				d.account.Server, d.account.Username, d.account.SessionID,
				native.DeviceID, native.RootID, d.grant.Fingerprint,
				s.SourceID, s.Revision, s.TargetNodeID,
				native.NativeKey, s.ContentSHA256)
			if scopeErr != nil {
				return errLocalPushDriverDenied
			}
			receipt, readErr := withHistoricalOriginalWriterReadOnly(
				nativeCtx, writerScope, func(heldCtx context.Context) (localpushrunner.FirstLeafResult, error) {
					return d.recoverPreviousFirstLeafReadOnly(heldCtx, s)
				})
			if readErr != nil {
				return errLocalPushDriverDenied
			}
			observed = receipt
			return nil
		})
	if err != nil || ctx.Err() != nil || !observed.Confirmed || observed.Uncertain {
		return uncertain, localpushrunner.ErrUncertain
	}
	return observed, nil
}
