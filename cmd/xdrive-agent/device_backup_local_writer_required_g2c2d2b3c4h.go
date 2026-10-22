package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/localpushrunner"
	"github.com/lazyxu/xdrive/internal/localpushwriter"
)

// requireLiveOriginalWriter is a fail-closed Agent-only admission preflight.
// The real manual Backup-only entry obtains the native original's strong
// identity, then creates its immutable OS-private Writer claim with Begin
// BEFORE attempting any Stage, key or HTTP upload. This method confirms
// that the same live Claim still has the original kernel lock/marker;
// it never creates a replacement claim, key or Stage.
//
// The callback ends before the later HTTP request. Commit/Reconcile must
// additionally hold that same Claim mutex and native file descriptor across
// their entire authenticated network callbacks, not rely on this preflight
// alone. A local Writer lock is NOT independent remote attestation.
func (d *localPushFirstLeafDriver) requireLiveOriginalWriter(
	ctx context.Context, s localpushrunner.Scope,
) error {
	if d == nil || ctx == nil || ctx.Err() != nil || s != d.scope ||
		!d.liveWriterRequired || d.liveWriter == nil ||
		d.liveWriterOriginalKey == "" {
		return errLocalPushDriverDenied
	}
	writerScope, err := localpushwriter.NewScope(
		d.configDir, d.grant.Path, d.account.Server, d.account.Username,
		d.account.SessionID, s.DeviceID, s.RootID, d.grant.Fingerprint,
		s.SourceID, s.Revision, s.TargetNodeID, d.liveWriterOriginalKey,
		s.ContentSHA256,
	)
	if err != nil {
		return errLocalPushDriverDenied
	}
	if err := localpushwriter.WithHeldLiveOriginalWriterObservation(
		ctx, d.liveWriter, writerScope,
		func(heldCtx context.Context) error {
			return heldCtx.Err()
		},
	); err != nil {
		return errLocalPushDriverDenied
	}
	return nil
}
