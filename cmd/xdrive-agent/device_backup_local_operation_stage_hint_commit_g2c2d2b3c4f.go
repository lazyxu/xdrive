package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/localpushrunner"
	"github.com/lazyxu/xdrive/internal/localpushstage"
)

// withOriginalStageHeldDuringCommit pins the SAME on-disk, Root-bound
// original Stage hint throughout the owning Agent's native-fd/Writer-Claim
// HTTP CAS/SQL callback. An ACK alone cannot replace this pinned identity.
//
// This is only a local provenance fence: it does not prove a remote kernel
// lock or authorize physical-COMMIT/CANCEL, Stage/key retirement or file #2.
// A changed hint AFTER the network request must return an error so the
// caller retains UNCERTAIN and never silently retries a new operation.
func (d *localPushFirstLeafDriver) withOriginalStageHeldDuringCommit(
	ctx context.Context, scope localpushrunner.Scope,
	stage localpushrunner.Staged, op localpushrunner.Operation,
	commit func(context.Context) error,
) error {
	if d == nil || ctx == nil || ctx.Err() != nil || commit == nil ||
		scope != d.scope || !d.operationMatches(scope, stage, op) ||
		!localPushFirstLeafNameValid(scope.RelativePath) {
		return errLocalPushDriverDenied
	}
	err := localpushstage.WithHeldLocalOriginalRecoveryHint(
		ctx, d.configDir, d.grant, stage.StageID,
		func(heldCtx context.Context, hint localpushstage.LocalOriginalRecoveryHint) error {
			if heldCtx.Err() != nil || hint.Stage != d.stage ||
				hint.RelativePath != scope.RelativePath || hint.CreatedAt.IsZero() {
				return errLocalPushDriverDenied
			}
			return commit(heldCtx)
		},
	)
	if err != nil || ctx.Err() != nil {
		return errLocalPushDriverDenied
	}
	return nil
}
