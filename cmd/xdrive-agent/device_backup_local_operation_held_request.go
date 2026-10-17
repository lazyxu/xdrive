package main

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// withBoundLocalPushHeldRequest is an Agent-private integration boundary.
// The action runs only inside the existing verified, still-held native
// directory window. It is deliberately NOT an HTTP/IPC/SourceRun entrypoint
// and does not transfer commit authority or a native OS handle to the Server.
func withBoundLocalPushHeldRequest(
	ctx context.Context, configDir string, account userconfig.Config,
	sourceID uint64, request localpush.LocalFirstDirectoryNativeRecheckRequest,
	newRequest bool,
	currentSession func() (userconfig.Config, error),
	readBound localFirstDirectoryBoundReader,
	readNativeHeld localFirstDirectoryNativeHeldReader,
	action func(context.Context, localPushPrivateRequestKey) error,
) error {
	denied := func(err error) error { return privateLocalFirstDirectoryBoundError(err) }
	if ctx == nil || sourceID == 0 || request.SourceID != sourceID ||
		request.SourceRevision == 0 || account.Server == "" || account.Username == "" ||
		account.SessionID == "" || account.SessionInvalid ||
		currentSession == nil || readBound == nil || readNativeHeld == nil || action == nil {
		return denied(nil)
	}
	if err := ctx.Err(); err != nil {
		return denied(err)
	}

	var firstSource client.Source
	var firstProof client.LocalBoundSourceProof
	var scope localPushRequestKeyScope
	reads, attempts, completed := 0, 0, 0
	sameSession := func() bool {
		latest, err := currentSession()
		return err == nil && !latest.SessionInvalid &&
			latest.Server == account.Server &&
			latest.Username == account.Username &&
			latest.SessionID == account.SessionID
	}
	// Every read must independently verify the live owning Agent's Server
	// identity and the actual native Root. Never form a durable key scope
	// from a Renderer ID, requested path or a previously cached Source.
	verifyBound := func(readCtx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
		if readCtx == nil || readCtx.Err() != nil || id != sourceID || !sameSession() {
			return client.Source{}, client.LocalBoundSourceProof{}, errLocalPushRequestKeyUnavailable
		}
		source, proof, err := readBound(readCtx, id)
		if err != nil || !validBoundFirstDirectorySource(source, proof, sourceID) ||
			source.Revision != request.SourceRevision || source.TargetNodeID == nil {
			return client.Source{}, client.LocalBoundSourceProof{}, errLocalPushRequestKeyUnavailable
		}
		grant, err := localpush.LoadRootGrant(configDir, account.Server, account.Username, proof.RootID)
		if err != nil || !grant.StrongIdentity || grant.Server != account.Server ||
			grant.Account != account.Username || grant.SourceID != sourceID ||
			grant.DeviceID != proof.DeviceID || grant.RootID != proof.RootID ||
			grant.Fingerprint != proof.RootFingerprint {
			return client.Source{}, client.LocalBoundSourceProof{}, errLocalPushRequestKeyUnavailable
		}
		next := localPushRequestKeyScope{
			server: account.Server, account: account.Username, sessionID: account.SessionID,
			deviceID: proof.DeviceID, rootID: proof.RootID,
			rootFingerprint: proof.RootFingerprint,
			sourceID:        sourceID, revision: source.Revision, targetNodeID: *source.TargetNodeID,
		}
		if !validLocalPushRequestScope(next) || !sameSession() {
			return client.Source{}, client.LocalBoundSourceProof{}, errLocalPushRequestKeyUnavailable
		}
		if reads == 0 {
			firstSource, firstProof, scope = source, proof, next
		} else if next != scope || proof != firstProof ||
			!sameBoundFirstDirectorySource(source, firstSource) {
			return client.Source{}, client.LocalBoundSourceProof{}, errLocalPushRequestKeyUnavailable
		}
		reads++
		return source, proof, nil
	}

	_, err := observeLocalBoundFirstDirectoryHeld(ctx, sourceID, request, verifyBound,
		func(heldCtx context.Context, proof client.LocalBoundSourceProof,
			selector localpush.LocalFirstDirectoryNativeRecheckRequest,
			checkpoint func(context.Context, localpush.LocalFirstDirectoryNativeObservation) error,
		) (localpush.LocalFirstDirectoryNativeObservation, error) {
			return readNativeHeld(heldCtx, proof, selector,
				func(checkCtx context.Context, candidate localpush.LocalFirstDirectoryNativeObservation) error {
					// The second authenticated Server read is performed by
					// checkpoint BEFORE the action can read a request key.
					if err := checkpoint(checkCtx, candidate); err != nil {
						return err
					}
					if attempts != 0 || reads != 2 || !sameSession() {
						return errLocalPushRequestKeyUnavailable
					}
					attempts++
					var key localPushPrivateRequestKey
					var err error
					if newRequest {
						key, err = mintLocalPushOperationRequestKey(configDir, scope)
					} else {
						key, err = loadLocalPushOperationRequestKey(configDir, scope)
					}
					if err != nil || key.bytes == [32]byte{} || checkCtx.Err() != nil {
						return errLocalPushRequestKeyUnavailable
					}
					// Future bounded Server preparation may run here; for now
					// no production action or network transport is attached.
					actionCtx, cancel := context.WithTimeout(checkCtx, 8*time.Second)
					err = action(actionCtx, key)
					actionErr := actionCtx.Err()
					cancel()
					if err != nil {
						return err
					}
					if actionErr != nil {
						return actionErr
					}
					if checkCtx.Err() != nil {
						return checkCtx.Err()
					}
					// One final authenticated Source/Root/session read MUST
					// occur while the native directory handle remains held.
					if _, _, err := verifyBound(checkCtx, sourceID); err != nil {
						return err
					}
					completed++
					return checkCtx.Err()
				})
		})
	if err != nil {
		return denied(err)
	}
	if reads != 3 || attempts != 1 || completed != 1 || !sameSession() {
		return denied(nil)
	}
	return nil
}

// withOwnLocalPushFirstDirectoryRequest is non-operational and package-private.
// It supplies the real native OS held-window reader and the credentialed
// owning-Agent Source/Root reader; there is no production caller yet.
func (c *agentController) withOwnLocalPushFirstDirectoryRequest(
	ctx context.Context, sourceID uint64,
	request localpush.LocalFirstDirectoryNativeRecheckRequest,
	newRequest bool,
	action func(context.Context, localPushPrivateRequestKey) error,
) error {
	if c == nil || ctx == nil || action == nil || sourceID == 0 ||
		request.SourceID != sourceID || !c.localFolderGrantMu.TryLock() {
		return privateLocalFirstDirectoryBoundError(nil)
	}
	defer c.localFolderGrantMu.Unlock()
	workCtx, cancel := context.WithTimeout(ctx, 150*time.Second)
	defer cancel()
	account, err := userconfig.Load()
	if err != nil {
		return privateLocalFirstDirectoryBoundError(err)
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return privateLocalFirstDirectoryBoundError(err)
	}
	return withBoundLocalPushHeldRequest(
		workCtx, configDir, account, sourceID, request, newRequest,
		userconfig.Load,
		func(ctx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
			source, proof, _, err := c.localBoundBackupConfig(ctx, id)
			return source, proof, err
		},
		func(ctx context.Context, proof client.LocalBoundSourceProof,
			selector localpush.LocalFirstDirectoryNativeRecheckRequest,
			checkpoint func(context.Context, localpush.LocalFirstDirectoryNativeObservation) error,
		) (localpush.LocalFirstDirectoryNativeObservation, error) {
			grant, err := localpush.LoadRootGrant(
				configDir, account.Server, account.Username, proof.RootID)
			if err != nil || !grant.StrongIdentity || grant.SourceID != sourceID ||
				grant.DeviceID != proof.DeviceID || grant.RootID != proof.RootID ||
				grant.Fingerprint != proof.RootFingerprint {
				return localpush.LocalFirstDirectoryNativeObservation{},
					errLocalPushRequestKeyUnavailable
			}
			return localpush.RecheckLocalFirstDirectoryNativeWithHeldCheckpoint(
				ctx, configDir, grant, selector, checkpoint)
		},
		action,
	)
}
