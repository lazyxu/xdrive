package main

import (
	"context"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// The local recovery hint is not a cross-machine operation/Stage binding.
// This gate is ONLY for co-observing one first-leaf historical CAS receipt
// while a fresh CURRENT native original is held open and double-hashed.
func matchesLocalPushHeldOriginalCASStage(
	hint localpushstage.LocalOriginalRecoveryHint, stageID string,
	sourceID, revision uint64, relativePath, snapshot, content, pathKey string,
	size int64,
) bool {
	return stageID != "" && sourceID != 0 && revision != 0 &&
		relativePath != "" && len(relativePath) <= 255 &&
		relativePath != "." && relativePath != ".." &&
		strings.TrimSpace(relativePath) == relativePath &&
		!strings.ContainsAny(relativePath, "/\\") &&
		!hint.CreatedAt.IsZero() &&
		hint.Stage.StageID == stageID &&
		hint.Stage.SourceID == sourceID && hint.Stage.Revision == revision &&
		hint.RelativePath == relativePath &&
		hint.Stage.SnapshotSHA256 == snapshot &&
		hint.Stage.SHA256 == content &&
		hint.Stage.CurrentPathKey == pathKey && hint.Stage.Size == size
}

// inspectLocalBoundBackupHeldOriginalCAS is deliberately UNROUTED: owning
// Agent ONLY, no IPC, renderer, Web, scheduler, SourceRun or physical writer.
// The result is PRIVATE/ephemeral; CAS, operation and file observations can
// drift the moment the two process-local pins are released.
func (c *agentController) inspectLocalBoundBackupHeldOriginalCAS(
	ctx context.Context, sourceID, revision uint64, stageID string,
) (localPushHeldOriginalOperationObservation, error) {
	var empty localPushHeldOriginalOperationObservation
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
	source, proof, _, err := c.localBoundBackupConfig(workCtx, sourceID)
	if err != nil || !validBoundFirstDirectorySource(source, proof, sourceID) ||
		source.Revision != revision {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	grant, err := localpush.LoadRootGrant(
		configDir, account.Server, account.Username, proof.RootID)
	if err != nil || !grant.StrongIdentity ||
		grant.Server != account.Server || grant.Account != account.Username ||
		grant.SourceID != sourceID || grant.DeviceID != proof.DeviceID ||
		grant.RootID != proof.RootID || grant.Fingerprint != proof.RootFingerprint {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	hint, err := localpushstage.ReadLocalOriginalRecoveryHint(
		workCtx, configDir, grant, stageID)
	if err != nil {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	pathKey, err := localpush.LocalInventoryPathKey(grant, "file", hint.RelativePath)
	if err != nil || !matchesLocalPushHeldOriginalCASStage(
		hint, stageID, sourceID, revision, hint.RelativePath,
		hint.Stage.SnapshotSHA256, hint.Stage.SHA256, pathKey, hint.Stage.Size) {
		return empty, privateLocalFirstDirectoryBoundError(err)
	}
	var currentClient *client.Client
	return observeBoundLocalPushHeldOriginalOperation(
		workCtx, configDir, account, sourceID, revision, hint.RelativePath,
		hint.Stage.SnapshotSHA256, hint.Stage.SHA256, hint.Stage.Size,
		userconfig.Load,
		func(readCtx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
			checked, boundProof, cli, readErr := c.localBoundBackupConfig(readCtx, id)
			if readErr == nil {
				currentClient = cli
			}
			return checked, boundProof, readErr
		},
		func(readCtx context.Context, id, rev uint64,
			boundProof client.LocalBoundSourceProof, operationID string, generation uint64,
		) (client.LocalPushOperationStatus, error) {
			if currentClient == nil {
				return client.LocalPushOperationStatus{}, errLocalPushRequestKeyUnavailable
			}
			return currentClient.ObserveLocalPushOperation(
				readCtx, id, rev, boundProof, operationID, generation)
		},
		localPushHeldOriginalCASCheck{
			stageID: stageID,
			read: func(readCtx context.Context, id, rev uint64,
				boundProof client.LocalBoundSourceProof, selectedStage, leaf string,
			) (client.LocalPushFirstLeafPhysicalReceipt, error) {
				if currentClient == nil {
					return client.LocalPushFirstLeafPhysicalReceipt{}, errLocalPushRequestKeyUnavailable
				}
				return currentClient.ReadLocalPushFirstLeafPhysicalReceipt(
					readCtx, id, rev, boundProof, selectedStage, leaf)
			},
		},
	)
}
