package main

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// localPushPrivateReconciledReceipt is a PRIVATE status-only observation.
// In particular, "aborted" means only that a 30s Server reservation was
// aborted, not that physical bytes or a SourceRun were ever cancelled.
// Unexported fields cannot become Renderer, Web or Agent IPC JSON.
type localPushPrivateReconciledReceipt struct {
	operationID string
	generation  uint64
	state       string
}

// withBoundLocalPushReconciledReceipt reopens the exact existing request
// key and its immutable UUID/generation correlation under the *currently*
// owning and still-held native directory window. It never generates a new
// key, never changes Server operation state, never starts file work and
// never retires the local key/claim, including on an expired lease.
func withBoundLocalPushReconciledReceipt(
	ctx context.Context, configDir string, account userconfig.Config,
	sourceID uint64, request localpush.LocalFirstDirectoryNativeRecheckRequest,
	currentSession func() (userconfig.Config, error),
	readBound localFirstDirectoryBoundReader,
	readNativeHeld localFirstDirectoryNativeHeldReader,
	observe localPushPrivateObserve,
) (localPushPrivateReconciledReceipt, error) {
	var empty localPushPrivateReconciledReceipt
	deny := func(err error) (localPushPrivateReconciledReceipt, error) {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	if ctx == nil || currentSession == nil || readBound == nil ||
		readNativeHeld == nil || observe == nil {
		return deny(nil)
	}
	var current client.Source
	var proof client.LocalBoundSourceProof
	var reads int
	var reconciled localPushPrivateReconciledReceipt
	err := withBoundLocalPushHeldRequest(
		ctx, configDir, account, sourceID, request, false,
		currentSession,
		func(readCtx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
			source, boundProof, readErr := readBound(readCtx, id)
			if readErr == nil {
				current, proof = source, boundProof
				reads++
			}
			return source, boundProof, readErr
		},
		readNativeHeld,
		func(actionCtx context.Context, key localPushPrivateRequestKey) error {
			// The existing held checkpoint has already validated the native
			// handle, inventory generations and TWO current Server/Root
			// reads. No stored receipt may bypass those rechecks.
			if reads != 2 || !validBoundFirstDirectorySource(current, proof, sourceID) ||
				current.Revision != request.SourceRevision ||
				current.TargetNodeID == nil || key.bytes == [32]byte{} {
				return errLocalPushRequestKeyUnavailable
			}
			scope := localPushRequestKeyScope{
				server: account.Server, account: account.Username, sessionID: account.SessionID,
				deviceID: proof.DeviceID, rootID: proof.RootID,
				rootFingerprint: proof.RootFingerprint,
				sourceID:        sourceID, revision: current.Revision,
				targetNodeID: *current.TargetNodeID,
			}
			receipt, err := loadLocalPushPreparedReceipt(configDir, scope, key)
			if err != nil || !validLocalPushRequestUUID(receipt.operationID) ||
				receipt.generation == 0 {
				return errLocalPushRequestKeyUnavailable
			}
			status, err := observe(actionCtx, sourceID, current.Revision, proof,
				receipt.operationID, receipt.generation)
			if err != nil || status.SourceID != sourceID ||
				status.Revision != current.Revision ||
				status.OperationID != receipt.operationID ||
				status.Generation != receipt.generation ||
				(status.State != "reserved" &&
					status.State != "aborted" && status.State != "expired") {
				return errLocalPushRequestKeyUnavailable
			}
			// Status remains non-authoritative. In particular, an expired or
			// aborted private admission NEVER authorizes new work or removal
			// of a still-unreconciled durable request key.
			reconciled = localPushPrivateReconciledReceipt{
				operationID: receipt.operationID, generation: receipt.generation,
				state: status.State,
			}
			return actionCtx.Err()
		},
	)
	if err != nil || reads != 3 || reconciled.operationID == "" {
		return deny(err)
	}
	return reconciled, nil
}

// inspectLocalBoundBackupReconciledReceipt is deliberately UNROUTED.
// Only this native Agent process supplies credentialed Server Source
// reads, OS-held Root verification and the exact enrolled device secret.
// There is no scheduler, IPC, REST, Electron, Renderer or Web caller.
func (c *agentController) inspectLocalBoundBackupReconciledReceipt(
	ctx context.Context, sourceID uint64,
	request localpush.LocalFirstDirectoryNativeRecheckRequest,
) (localPushPrivateReconciledReceipt, error) {
	var empty localPushPrivateReconciledReceipt
	if c == nil || ctx == nil || sourceID == 0 ||
		request.SourceID != sourceID || !c.localFolderGrantMu.TryLock() {
		return empty, privateLocalFirstDirectoryBoundError(nil)
	}
	defer c.localFolderGrantMu.Unlock()
	workCtx, cancel := context.WithTimeout(ctx, 150*time.Second)
	defer cancel()
	account, err := userconfig.Load()
	if err != nil || account.Server == "" || account.Username == "" ||
		account.SessionID == "" || account.SessionInvalid {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	var currentClient *client.Client
	return withBoundLocalPushReconciledReceipt(
		workCtx, configDir, account, sourceID, request,
		userconfig.Load,
		func(readCtx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
			source, proof, cli, readErr := c.localBoundBackupConfig(readCtx, id)
			if readErr == nil {
				currentClient = cli
			}
			return source, proof, readErr
		},
		func(heldCtx context.Context, proof client.LocalBoundSourceProof,
			selector localpush.LocalFirstDirectoryNativeRecheckRequest,
			checkpoint func(context.Context, localpush.LocalFirstDirectoryNativeObservation) error,
		) (localpush.LocalFirstDirectoryNativeObservation, error) {
			grant, loadErr := localpush.LoadRootGrant(
				configDir, account.Server, account.Username, proof.RootID)
			if loadErr != nil || !grant.StrongIdentity ||
				grant.Server != account.Server || grant.Account != account.Username ||
				grant.SourceID != sourceID || grant.DeviceID != proof.DeviceID ||
				grant.RootID != proof.RootID ||
				grant.Fingerprint != proof.RootFingerprint {
				return localpush.LocalFirstDirectoryNativeObservation{},
					errLocalPushRequestKeyUnavailable
			}
			return localpush.RecheckLocalFirstDirectoryNativeWithHeldCheckpoint(
				heldCtx, configDir, grant, selector, checkpoint)
		},
		func(actionCtx context.Context, id, revision uint64, proof client.LocalBoundSourceProof,
			operationID string, generation uint64,
		) (client.LocalPushOperationStatus, error) {
			if currentClient == nil {
				return client.LocalPushOperationStatus{}, errLocalPushRequestKeyUnavailable
			}
			return currentClient.ObserveLocalPushOperation(
				actionCtx, id, revision, proof, operationID, generation)
		},
	)
}
