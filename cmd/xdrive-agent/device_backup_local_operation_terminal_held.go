package main

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// localPushPrivateHeldTerminal is a status-only, non-authoritative result.
// It cannot prove physical bytes, a stopped transfer, source completion or
// entitlement to delete/reissue the original native request key.
type localPushPrivateHeldTerminal struct {
	operationID string
	generation  uint64
	state       string
	recordedAt  time.Time
}

type localPushPrivateTerminalReader func(
	context.Context, uint64, uint64, client.LocalBoundSourceProof,
	[32]byte, string, uint64,
) (client.LocalPushTerminalProof, error)

// withBoundLocalPushHeldTerminal is an Agent-only private composition.
// Reuses the original stored OS request key and HMAC-prepared UUID/generation
// only after the current owning native Root and TWO current Server reads.
// A third authenticated read and native identity check finish while the Root
// handle is still held. No successful outcome can retire the key/claim.
func withBoundLocalPushHeldTerminal(
	ctx context.Context, configDir string, account userconfig.Config,
	sourceID uint64, request localpush.LocalFirstDirectoryNativeRecheckRequest,
	currentSession func() (userconfig.Config, error),
	readBound localFirstDirectoryBoundReader,
	readNativeHeld localFirstDirectoryNativeHeldReader,
	readTerminal localPushPrivateTerminalReader,
) (localPushPrivateHeldTerminal, error) {
	var empty localPushPrivateHeldTerminal
	deny := func(err error) (localPushPrivateHeldTerminal, error) {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	if ctx == nil || currentSession == nil || readBound == nil ||
		readNativeHeld == nil || readTerminal == nil {
		return deny(nil)
	}
	var current client.Source
	var proof client.LocalBoundSourceProof
	var reads int
	var observed localPushPrivateHeldTerminal
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
			correlation, err := loadLocalPushPreparedReceipt(configDir, scope, key)
			if err != nil || !validLocalPushRequestUUID(correlation.operationID) ||
				correlation.generation == 0 {
				return errLocalPushRequestKeyUnavailable
			}
			receipt, err := readTerminal(actionCtx, sourceID, current.Revision, proof,
				key.bytes, correlation.operationID, correlation.generation)
			if err != nil || receipt.SourceID != sourceID ||
				receipt.Revision != current.Revision ||
				receipt.OperationID != correlation.operationID ||
				receipt.Generation != correlation.generation ||
				(receipt.State != "aborted" && receipt.State != "expired") ||
				receipt.RecordedAt.IsZero() || receipt.RecordedAt.Location() != time.UTC {
				return errLocalPushRequestKeyUnavailable
			}
			observed = localPushPrivateHeldTerminal{
				operationID: correlation.operationID, generation: correlation.generation,
				state: receipt.State, recordedAt: receipt.RecordedAt,
			}
			return actionCtx.Err()
		},
	)
	if err != nil || reads != 3 || observed.operationID == "" {
		return deny(err)
	}
	return observed, nil
}

// inspectLocalBoundBackupTerminalProof remains UNROUTED. Only the owning
// xdrive-agent has the OS-private credential and real held-directory reader.
// No browser, foreign Desktop, scheduler or renderer can invoke this path.
func (c *agentController) inspectLocalBoundBackupTerminalProof(
	ctx context.Context, sourceID uint64,
	request localpush.LocalFirstDirectoryNativeRecheckRequest,
) (localPushPrivateHeldTerminal, error) {
	var empty localPushPrivateHeldTerminal
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
	return withBoundLocalPushHeldTerminal(
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
				grant.RootID != proof.RootID || grant.Fingerprint != proof.RootFingerprint {
				return localpush.LocalFirstDirectoryNativeObservation{},
					errLocalPushRequestKeyUnavailable
			}
			return localpush.RecheckLocalFirstDirectoryNativeWithHeldCheckpoint(
				heldCtx, configDir, grant, selector, checkpoint)
		},
		func(actionCtx context.Context, id, revision uint64,
			proof client.LocalBoundSourceProof, key [32]byte,
			operationID string, generation uint64,
		) (client.LocalPushTerminalProof, error) {
			if currentClient == nil {
				return client.LocalPushTerminalProof{}, errLocalPushRequestKeyUnavailable
			}
			return currentClient.ReadLocalPushTerminalProof(
				actionCtx, id, revision, proof, key, operationID, generation)
		},
	)
}
