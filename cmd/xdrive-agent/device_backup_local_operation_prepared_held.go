package main

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// Agent-only injected transports allow exact lost-reply and authorization
// regression tests without making this function available to Agent IPC.
type localPushPrivatePrepare func(context.Context, uint64, uint64,
	client.LocalBoundSourceProof, [32]byte) (client.LocalPushPreparedOperation, error)
type localPushPrivateObserve func(context.Context, uint64, uint64,
	client.LocalBoundSourceProof, string, uint64) (client.LocalPushOperationStatus, error)

// An optional private test seam; only the owning Agent supplies the real
// durable writer. No Renderer/IPC can pass a persistence callback.
type localPushPreparedReceiptWriter func(string, localPushRequestKeyScope,
	localPushPrivateRequestKey, client.LocalPushPreparedOperation) error

// withBoundLocalPushPreparedOperation is a PRIVATE native/Server read window.
// The existing held witness independently checks the owner/Root/Source before,
// during and after this action. Only the same request key can be recovered;
// a lost HTTP response leaves that key durable. A positive observation is
// NOT a native-to-PostgreSQL write lease, FileVersion or successful backup.
func withBoundLocalPushPreparedOperation(
	ctx context.Context, configDir string, account userconfig.Config,
	sourceID uint64, request localpush.LocalFirstDirectoryNativeRecheckRequest,
	newRequest bool,
	currentSession func() (userconfig.Config, error),
	readBound localFirstDirectoryBoundReader,
	readNativeHeld localFirstDirectoryNativeHeldReader,
	prepare localPushPrivatePrepare, observe localPushPrivateObserve,
	receiptWriters ...localPushPreparedReceiptWriter,
) (client.LocalPushPreparedOperation, error) {
	var empty client.LocalPushPreparedOperation
	deny := func(err error) (client.LocalPushPreparedOperation, error) {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	if ctx == nil || readBound == nil || readNativeHeld == nil ||
		prepare == nil || observe == nil || currentSession == nil ||
		len(receiptWriters) > 1 || (len(receiptWriters) == 1 && receiptWriters[0] == nil) {
		return deny(nil)
	}
	var current client.Source
	var proof client.LocalBoundSourceProof
	var boundReads int
	var prepared client.LocalPushPreparedOperation
	err := withBoundLocalPushHeldRequest(
		ctx, configDir, account, sourceID, request, newRequest,
		currentSession,
		func(readCtx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
			source, boundProof, readErr := readBound(readCtx, id)
			if readErr == nil {
				current, proof = source, boundProof
				boundReads++
			}
			return source, boundProof, readErr
		},
		readNativeHeld,
		func(actionCtx context.Context, key localPushPrivateRequestKey) error {
			// The second credentialed Server read has happened INSIDE the
			// still-open native checkpoint before either HTTP operation.
			if boundReads != 2 || !validBoundFirstDirectorySource(current, proof, sourceID) ||
				current.Revision != request.SourceRevision || current.TargetNodeID == nil ||
				key.bytes == [32]byte{} {
				return errLocalPushRequestKeyUnavailable
			}
			candidate, err := prepare(actionCtx, sourceID, current.Revision, proof, key.bytes)
			if err != nil || candidate.SourceID != sourceID ||
				candidate.Revision != request.SourceRevision ||
				!validLocalPushRequestUUID(candidate.OperationID) ||
				candidate.Generation == 0 || candidate.State != "reserved" {
				return errLocalPushRequestKeyUnavailable
			}
			// A separately authorized Server observation proves only the
			// same newest reserved generation, never successful upload.
			status, err := observe(actionCtx, sourceID, current.Revision, proof,
				candidate.OperationID, candidate.Generation)
			if err != nil || status.SourceID != candidate.SourceID ||
				status.Revision != candidate.Revision ||
				status.OperationID != candidate.OperationID ||
				status.Generation != candidate.Generation || status.State != "reserved" {
				return errLocalPushRequestKeyUnavailable
			}
			// Persist an offline-only UUID/generation correlation BEFORE the
			// third Server/Root read and before native handle release. A
			// missed or failed credential-store ACK leaves the key and claim
			// intact and denies success, never granting backup authority.
			if len(receiptWriters) == 1 {
				scope := localPushRequestKeyScope{
					server: account.Server, account: account.Username, sessionID: account.SessionID,
					deviceID: proof.DeviceID, rootID: proof.RootID,
					rootFingerprint: proof.RootFingerprint,
					sourceID:        sourceID, revision: current.Revision,
					targetNodeID: *current.TargetNodeID,
				}
				if err := receiptWriters[0](configDir, scope, key, candidate); err != nil {
					return errLocalPushRequestKeyUnavailable
				}
			}
			prepared = candidate
			return actionCtx.Err()
		},
	)
	if err != nil || boundReads != 3 || prepared.OperationID == "" {
		return deny(err)
	}
	return prepared, nil
}

// inspectLocalBoundBackupPreparedOperation is intentionally UNROUTED.
// Only an owning Agent with the native, strong-identity Root and signed-in
// Server session can make these authenticated read/admission requests.
// No scheduler, SourceRun, Electron/Renderer/Web, or canonical writer calls it.
func (c *agentController) inspectLocalBoundBackupPreparedOperation(
	ctx context.Context, sourceID uint64,
	request localpush.LocalFirstDirectoryNativeRecheckRequest, newRequest bool,
) (client.LocalPushPreparedOperation, error) {
	var empty client.LocalPushPreparedOperation
	if c == nil || ctx == nil || sourceID == 0 || request.SourceID != sourceID ||
		!c.localFolderGrantMu.TryLock() {
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
	return withBoundLocalPushPreparedOperation(
		workCtx, configDir, account, sourceID, request, newRequest,
		userconfig.Load,
		func(readCtx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
			source, proof, cli, err := c.localBoundBackupConfig(readCtx, id)
			if err == nil {
				currentClient = cli
			}
			return source, proof, err
		},
		func(heldCtx context.Context, proof client.LocalBoundSourceProof,
			selector localpush.LocalFirstDirectoryNativeRecheckRequest,
			checkpoint func(context.Context, localpush.LocalFirstDirectoryNativeObservation) error,
		) (localpush.LocalFirstDirectoryNativeObservation, error) {
			grant, err := localpush.LoadRootGrant(
				configDir, account.Server, account.Username, proof.RootID)
			if err != nil || !grant.StrongIdentity ||
				grant.Server != account.Server || grant.Account != account.Username ||
				grant.SourceID != sourceID || grant.DeviceID != proof.DeviceID ||
				grant.RootID != proof.RootID || grant.Fingerprint != proof.RootFingerprint {
				return localpush.LocalFirstDirectoryNativeObservation{}, errLocalPushRequestKeyUnavailable
			}
			return localpush.RecheckLocalFirstDirectoryNativeWithHeldCheckpoint(
				heldCtx, configDir, grant, selector, checkpoint)
		},
		func(actionCtx context.Context, id, revision uint64, proof client.LocalBoundSourceProof,
			key [32]byte,
		) (client.LocalPushPreparedOperation, error) {
			if currentClient == nil {
				return empty, errLocalPushRequestKeyUnavailable
			}
			return currentClient.PrepareLocalPushOperation(actionCtx, id, revision, proof, key)
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
		persistLocalPushPreparedReceipt,
	)
}
