package main

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// This Agent-only result is a transient READ observation, NOT a cross-machine
// file writer lease, successful backup, cancel proof or key retirement ticket.
// The unexported fields prevent accidental JSON serialization into Renderer.
type localPushHeldOriginalOperationObservation struct {
	native  localpush.NativeHeldCurrentOriginal
	receipt localPushPrivatePreparedReceipt
}

// observeBoundLocalPushHeldOriginalOperation correlates a saved, MAC-bound
// operation UUID/generation with an EXACT original file while its native fd
// stays open. The native helper hashes that same descriptor AGAIN afterwards.
// No CAS/SQL mutation or SourceRun occurs; the Server status can go stale as
// soon as it is observed and MUST NOT authorize a physical writer.
func observeBoundLocalPushHeldOriginalOperation(
	ctx context.Context, configDir string, account userconfig.Config,
	sourceID, revision uint64, relativePath, snapshotSHA256, contentSHA256 string,
	size int64, currentSession func() (userconfig.Config, error),
	readBound localFirstDirectoryBoundReader, observe localPushPrivateObserve,
) (localPushHeldOriginalOperationObservation, error) {
	var empty localPushHeldOriginalOperationObservation
	deny := func(err error) (localPushHeldOriginalOperationObservation, error) {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	if ctx == nil || sourceID == 0 || revision == 0 || configDir == "" ||
		relativePath == "" || size < 0 || size > 64<<20 ||
		account.Server == "" || account.Username == "" ||
		account.SessionID == "" || account.SessionInvalid ||
		currentSession == nil || readBound == nil || observe == nil {
		return deny(nil)
	}
	sameSession := func() bool {
		current, err := currentSession()
		return err == nil && !current.SessionInvalid &&
			current.Server == account.Server && current.Username == account.Username &&
			current.SessionID == account.SessionID
	}
	if ctx.Err() != nil || !sameSession() {
		return deny(ctx.Err())
	}
	before, proof, err := readBound(ctx, sourceID)
	if err != nil || !validBoundFirstDirectorySource(before, proof, sourceID) ||
		before.Revision != revision || !sameSession() {
		return deny(err)
	}
	grant, err := localpush.LoadRootGrant(configDir, account.Server, account.Username, proof.RootID)
	if err != nil || !grant.StrongIdentity ||
		grant.Server != account.Server || grant.Account != account.Username ||
		grant.SourceID != sourceID || grant.DeviceID != proof.DeviceID ||
		grant.RootID != proof.RootID || grant.Fingerprint != proof.RootFingerprint {
		return deny(err)
	}
	pathKey, err := localpush.LocalInventoryPathKey(grant, "file", relativePath)
	if err != nil {
		return deny(err)
	}
	scope := localPushRequestKeyScope{}
	scope.server = account.Server
	scope.account = account.Username
	scope.sessionID = account.SessionID
	scope.deviceID = proof.DeviceID
	scope.rootID = proof.RootID
	scope.rootFingerprint = proof.RootFingerprint
	scope.sourceID = sourceID
	scope.revision = revision
	scope.targetNodeID = *before.TargetNodeID
	if !validLocalPushRequestScope(scope) {
		return deny(nil)
	}
	var result localPushHeldOriginalOperationObservation
	checkpoints := 0
	native, err := localpush.WithHeldCurrentOriginalReadCheckpoint(
		ctx, configDir, grant, snapshotSHA256, relativePath, contentSHA256, size,
		func(heldCtx context.Context, file localpush.NativeHeldCurrentOriginal) error {
			checkpoints++
			if checkpoints != 1 || heldCtx.Err() != nil || ctx.Err() != nil ||
				!sameSession() || file.SourceID != sourceID ||
				file.DeviceID != proof.DeviceID || file.RootID != proof.RootID ||
				file.RelativePath != relativePath || file.PathKey != pathKey ||
				file.SnapshotSHA256 != snapshotSHA256 ||
				file.ContentSHA256 != contentSHA256 || file.Size != size ||
				file.NativeKey == "" {
				return errLocalPushRequestKeyUnavailable
			}
			second, secondProof, err := readBound(heldCtx, sourceID)
			if err != nil || !validBoundFirstDirectorySource(second, secondProof, sourceID) ||
				secondProof != proof || !sameBoundFirstDirectorySource(before, second) ||
				!sameSession() {
				return errLocalPushRequestKeyUnavailable
			}
			// Load ONLY the original durable key; never generate a replacement.
			key, err := loadLocalPushOperationRequestKey(configDir, scope)
			if err != nil || key.bytes == [32]byte{} {
				return errLocalPushRequestKeyUnavailable
			}
			receipt, err := loadLocalPushPreparedReceipt(configDir, scope, key)
			if err != nil || !validLocalPushRequestUUID(receipt.operationID) ||
				receipt.generation == 0 {
				return errLocalPushRequestKeyUnavailable
			}
			status, err := observe(heldCtx, sourceID, revision, proof,
				receipt.operationID, receipt.generation)
			if err != nil || status.SourceID != sourceID || status.Revision != revision ||
				status.OperationID != receipt.operationID ||
				status.Generation != receipt.generation || status.State != "reserved" ||
				heldCtx.Err() != nil || !sameSession() {
				return errLocalPushRequestKeyUnavailable
			}
			third, thirdProof, err := readBound(heldCtx, sourceID)
			if err != nil || !validBoundFirstDirectorySource(third, thirdProof, sourceID) ||
				thirdProof != proof || !sameBoundFirstDirectorySource(before, third) ||
				!sameSession() {
				return errLocalPushRequestKeyUnavailable
			}
			reloaded, err := loadLocalPushPreparedReceipt(configDir, scope, key)
			if err != nil || reloaded != receipt || heldCtx.Err() != nil {
				return errLocalPushRequestKeyUnavailable
			}
			result.native = file
			result.receipt = receipt
			return heldCtx.Err()
		})
	if err != nil || checkpoints != 1 || result.receipt.operationID == "" ||
		native != result.native || native.SourceID != sourceID ||
		native.DeviceID != proof.DeviceID || native.RootID != proof.RootID ||
		native.PathKey != pathKey || native.SnapshotSHA256 != snapshotSHA256 ||
		native.ContentSHA256 != contentSHA256 || native.Size != size ||
		!sameSession() || ctx.Err() != nil {
		return deny(err)
	}
	return result, nil
}

// Owning Agent only: deliberately UNROUTED, without Desktop IPC, Renderer,
// Web, watcher, scheduled Runner, upload executor or SourceRun integration.
func (c *agentController) inspectLocalBoundBackupHeldOriginalOperation(
	ctx context.Context, sourceID, revision uint64,
	relativePath, snapshotSHA256, contentSHA256 string, size int64,
) (localPushHeldOriginalOperationObservation, error) {
	var empty localPushHeldOriginalOperationObservation
	if c == nil || ctx == nil || sourceID == 0 || revision == 0 ||
		!c.localFolderGrantMu.TryLock() {
		return empty, privateLocalFirstDirectoryBoundError(nil)
	}
	defer c.localFolderGrantMu.Unlock()
	workCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
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
	var cli *client.Client
	return observeBoundLocalPushHeldOriginalOperation(
		workCtx, configDir, account, sourceID, revision,
		relativePath, snapshotSHA256, contentSHA256, size, userconfig.Load,
		func(readCtx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
			source, proof, current, err := c.localBoundBackupConfig(readCtx, id)
			if err == nil {
				cli = current
			}
			return source, proof, err
		},
		func(readCtx context.Context, id, rev uint64, proof client.LocalBoundSourceProof,
			operationID string, generation uint64,
		) (client.LocalPushOperationStatus, error) {
			if cli == nil {
				return client.LocalPushOperationStatus{}, errLocalPushRequestKeyUnavailable
			}
			return cli.ObserveLocalPushOperation(readCtx, id, rev, proof, operationID, generation)
		},
	)
}
