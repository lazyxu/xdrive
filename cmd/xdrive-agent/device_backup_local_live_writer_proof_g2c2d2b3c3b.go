package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushrunner"
	"github.com/lazyxu/xdrive/internal/localpushwriter"
)

// withCurrentOriginalLiveWriterProof correlates the genuine ORIGINAL native
// descriptor with the STILL LOCKED owning Agent Writer claim throughout a
// subsequent bounded HTTP/SQL/CAS callback. The Writer claim is permanently
// source-scoped, while its marker is bound to the exact native original,
// Root, account/session and canonical content identity.
//
// This is only a native + Agent process-local proof. The server must still
// independently authorize Owner/Device/Root/Source/Operation and maintain
// the same transaction/CAS pin for any future durable file terminal.
// It does NOT authorize physical CANCEL, key/Stage retirement or file 2.
func (d *localPushFirstLeafDriver) withCurrentOriginalLiveWriterProof(
	ctx context.Context, scope localpushrunner.Scope,
	original localpush.NativeHeldCurrentOriginal,
	observe func(context.Context) error,
) error {
	if d == nil || !d.liveWriterRequired || d.liveWriter == nil ||
		ctx == nil || ctx.Err() != nil || observe == nil ||
		scope != d.scope || !d.nativeMatches(scope, original) {
		return errLocalPushDriverDenied
	}
	writerScope, err := localpushwriter.NewScope(
		d.configDir, d.grant.Path,
		d.account.Server, d.account.Username, d.account.SessionID,
		original.DeviceID, original.RootID, d.grant.Fingerprint,
		scope.SourceID, scope.Revision, scope.TargetNodeID,
		original.NativeKey, scope.ContentSHA256,
	)
	if err != nil {
		return errLocalPushDriverDenied
	}
	if err := localpushwriter.WithHeldLiveOriginalWriterObservation(
		ctx, d.liveWriter, writerScope, observe,
	); err != nil {
		return errLocalPushDriverDenied
	}
	return nil
}
