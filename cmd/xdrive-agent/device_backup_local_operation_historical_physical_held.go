package main

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// This historical result is deliberately unexported and ephemeral. A matched
// Server COMMIT/physical CAS read is NOT a backup completion/cancel receipt,
// an OS-key retirement ticket, or a cross-machine native-fd/SQL lease.
type localPushHeldHistoricalOperationPhysicalObservation struct {
	native   localpush.NativeHeldCurrentOriginal
	prepared localPushPrivatePreparedReceipt
	physical client.LocalPushHistoricalOperationPhysicalReceipt
}

type localPushHeldHistoricalOperationPhysicalRead func(
	context.Context, uint64, uint64, client.LocalBoundSourceProof,
	string, string, [32]byte, string, uint64,
) (client.LocalPushHistoricalOperationPhysicalReceipt, error)

// Unlike the live reservation observer, historical COMMIT reconciliation
// MUST NOT require the original 30-second reservation to remain "reserved".
// The exact original prepared UUID/generation+key, local CURRENT original and
// remote immutable SQL commit/pinned CAS are rechecked independently. The
// original native fd remains open DURING the remote read and is hashed AGAIN
// afterward. Neither pin survives this function.
func observeBoundLocalPushHeldHistoricalOperationPhysical(
	ctx context.Context, configDir string, account userconfig.Config,
	sourceID, revision uint64, stageID string,
	currentSession func() (userconfig.Config, error),
	readBound localFirstDirectoryBoundReader,
	readPhysical localPushHeldHistoricalOperationPhysicalRead,
) (localPushHeldHistoricalOperationPhysicalObservation, error) {
	var empty localPushHeldHistoricalOperationPhysicalObservation
	deny := func(err error) (localPushHeldHistoricalOperationPhysicalObservation, error) {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	if ctx == nil || configDir == "" || sourceID == 0 || revision == 0 ||
		stageID == "" || account.Server == "" || account.Username == "" ||
		account.SessionID == "" || account.SessionInvalid ||
		currentSession == nil || readBound == nil || readPhysical == nil {
		return deny(nil)
	}
	sameSession := func() bool {
		latest, err := currentSession()
		return err == nil && !latest.SessionInvalid &&
			latest.Server == account.Server &&
			latest.Username == account.Username &&
			latest.SessionID == account.SessionID
	}
	if ctx.Err() != nil || !sameSession() {
		return deny(ctx.Err())
	}
	before, proof, err := readBound(ctx, sourceID)
	if err != nil || !validBoundFirstDirectorySource(before, proof, sourceID) ||
		before.Revision != revision || !sameSession() {
		return deny(err)
	}
	grant, err := localpush.LoadRootGrant(
		configDir, account.Server, account.Username, proof.RootID)
	if err != nil || !grant.StrongIdentity ||
		grant.Server != account.Server || grant.Account != account.Username ||
		grant.SourceID != sourceID || grant.DeviceID != proof.DeviceID ||
		grant.RootID != proof.RootID || grant.Fingerprint != proof.RootFingerprint {
		return deny(err)
	}
	hint, err := localpushstage.ReadLocalOriginalRecoveryHint(
		ctx, configDir, grant, stageID)
	if err != nil {
		return deny(err)
	}
	pathKey, err := localpush.LocalInventoryPathKey(grant, "file", hint.RelativePath)
	if err != nil || !matchesLocalPushHeldOriginalCASStage(
		hint, stageID, sourceID, revision, hint.RelativePath,
		hint.Stage.SnapshotSHA256, hint.Stage.SHA256, pathKey, hint.Stage.Size,
	) || hint.Stage.Size < 0 || hint.Stage.Size > 64<<20 {
		return deny(err)
	}
	scope := localPushRequestKeyScope{
		server: account.Server, account: account.Username,
		sessionID: account.SessionID, deviceID: proof.DeviceID,
		rootID: proof.RootID, rootFingerprint: proof.RootFingerprint,
		sourceID: sourceID, revision: revision, targetNodeID: *before.TargetNodeID,
	}
	if !validLocalPushRequestScope(scope) {
		return deny(nil)
	}
	var result localPushHeldHistoricalOperationPhysicalObservation
	callbacks := 0
	native, err := localpush.WithHeldCurrentOriginalReadCheckpoint(
		ctx, configDir, grant, hint.Stage.SnapshotSHA256,
		hint.RelativePath, hint.Stage.SHA256, hint.Stage.Size,
		func(heldCtx context.Context, original localpush.NativeHeldCurrentOriginal) error {
			callbacks++
			if callbacks != 1 || heldCtx.Err() != nil || !sameSession() ||
				original.SourceID != sourceID || original.DeviceID != proof.DeviceID ||
				original.RootID != proof.RootID ||
				original.RelativePath != hint.RelativePath ||
				original.PathKey != pathKey ||
				original.SnapshotSHA256 != hint.Stage.SnapshotSHA256 ||
				original.ContentSHA256 != hint.Stage.SHA256 ||
				original.Size != hint.Stage.Size || original.NativeKey == "" {
				return errLocalPushRequestKeyUnavailable
			}
			second, secondProof, err := readBound(heldCtx, sourceID)
			if err != nil || !validBoundFirstDirectorySource(second, secondProof, sourceID) ||
				secondProof != proof || !sameBoundFirstDirectorySource(before, second) ||
				!sameSession() {
				return errLocalPushRequestKeyUnavailable
			}
			// Read the immutable original OS-private key and MAC-bound
			// prepared UUID/generation, even if Server reservation expired.
			key, err := loadLocalPushOperationRequestKey(configDir, scope)
			if err != nil || key.bytes == [32]byte{} {
				return errLocalPushRequestKeyUnavailable
			}
			prepared, err := loadLocalPushPreparedReceipt(configDir, scope, key)
			if err != nil || !validLocalPushRequestUUID(prepared.operationID) ||
				prepared.generation == 0 {
				return errLocalPushRequestKeyUnavailable
			}
			physical, err := readPhysical(
				heldCtx, sourceID, revision, proof, stageID,
				hint.RelativePath, key.bytes, prepared.operationID, prepared.generation)
			if err != nil || physical.SourceID != sourceID ||
				physical.Revision != revision || physical.StageID != stageID ||
				physical.OperationID != prepared.operationID ||
				physical.Generation != prepared.generation ||
				physical.NodeID == 0 || physical.SourceItemID == 0 ||
				!physical.CASObserved || physical.NativeVerified ||
				physical.BackupComplete || physical.CommitSupported ||
				physical.Authoritative || physical.RetirementSupported ||
				heldCtx.Err() != nil || !sameSession() {
				return errLocalPushRequestKeyUnavailable
			}
			// The HTTP result is historical; recheck the current owner,
			// Source, Root, local key and immutable prepared receipt AFTER
			// the remote read, still within the SAME open native descriptor.
			third, thirdProof, err := readBound(heldCtx, sourceID)
			if err != nil || !validBoundFirstDirectorySource(third, thirdProof, sourceID) ||
				thirdProof != proof || !sameBoundFirstDirectorySource(before, third) ||
				!sameSession() {
				return errLocalPushRequestKeyUnavailable
			}
			savedKey, err := loadLocalPushOperationRequestKey(configDir, scope)
			if err != nil || savedKey != key {
				return errLocalPushRequestKeyUnavailable
			}
			savedPrepared, err := loadLocalPushPreparedReceipt(configDir, scope, key)
			if err != nil || savedPrepared != prepared {
				return errLocalPushRequestKeyUnavailable
			}
			savedHint, err := localpushstage.ReadLocalOriginalRecoveryHint(
				heldCtx, configDir, grant, stageID)
			if err != nil || savedHint != hint {
				return errLocalPushRequestKeyUnavailable
			}
			savedRoot, err := localpush.LoadRootGrant(
				configDir, account.Server, account.Username, proof.RootID)
			if err != nil || savedRoot.Server != grant.Server ||
				savedRoot.Account != grant.Account ||
				savedRoot.SourceID != grant.SourceID ||
				savedRoot.DeviceID != grant.DeviceID ||
				savedRoot.RootID != grant.RootID ||
				savedRoot.Path != grant.Path ||
				savedRoot.Fingerprint != grant.Fingerprint ||
				!savedRoot.StrongIdentity ||
				!savedRoot.CreatedAt.Equal(grant.CreatedAt) ||
				heldCtx.Err() != nil || !sameSession() {
				return errLocalPushRequestKeyUnavailable
			}
			result.native = original
			result.prepared = prepared
			result.physical = physical
			return heldCtx.Err()
		},
	)
	if err != nil || callbacks != 1 || native != result.native ||
		native.SourceID != sourceID || native.DeviceID != proof.DeviceID ||
		native.RootID != proof.RootID || native.PathKey != pathKey ||
		native.ContentSHA256 != hint.Stage.SHA256 ||
		native.SnapshotSHA256 != hint.Stage.SnapshotSHA256 ||
		native.Size != hint.Stage.Size || native.NativeKey == "" ||
		result.prepared.operationID == "" || !result.physical.CASObserved ||
		ctx.Err() != nil || !sameSession() {
		return deny(err)
	}
	return result, nil
}

// Owning Agent-only, NOT an Electron IPC, Server Writer/Router, SourceRun or
// Scheduler action. Stage ID comes from an OS-private persisted recovery
// hint; the original prepared request key is never accepted from Renderer.
func (c *agentController) inspectLocalBoundBackupHeldHistoricalOperationPhysical(
	ctx context.Context, sourceID, revision uint64, stageID string,
) (localPushHeldHistoricalOperationPhysicalObservation, error) {
	var empty localPushHeldHistoricalOperationPhysicalObservation
	if c == nil || ctx == nil || sourceID == 0 || revision == 0 ||
		stageID == "" || !c.localFolderGrantMu.TryLock() {
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
	var currentClient *client.Client
	return observeBoundLocalPushHeldHistoricalOperationPhysical(
		workCtx, configDir, account, sourceID, revision, stageID,
		userconfig.Load,
		func(readCtx context.Context, id uint64) (
			client.Source, client.LocalBoundSourceProof, error,
		) {
			source, proof, cli, readErr := c.localBoundBackupConfig(readCtx, id)
			if readErr == nil {
				currentClient = cli
			}
			return source, proof, readErr
		},
		func(readCtx context.Context, id, rev uint64,
			proof client.LocalBoundSourceProof, stage, leaf string,
			key [32]byte, operationID string, generation uint64,
		) (client.LocalPushHistoricalOperationPhysicalReceipt, error) {
			if currentClient == nil {
				return client.LocalPushHistoricalOperationPhysicalReceipt{},
					errLocalPushRequestKeyUnavailable
			}
			return currentClient.ReadLocalPushHistoricalOperationPhysicalReceipt(
				readCtx, id, rev, proof, stage, leaf, key, operationID, generation)
		},
	)
}
