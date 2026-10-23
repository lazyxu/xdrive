//go:build linux || windows

package main

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// uploadLocalCommonFirstLeafPrivate binds the original, persisted v2 file
// Plan to the owning Agent's real Client and native offset stream. It is an
// internal implementation entry, intentionally NOT routed from Desktop IPC,
// Renderer, generic Source scheduler or a public HTTP endpoint yet.
//
// Server independently denies existing legacy SQL claims; this Agent also
// denies any local original Stage, operation key or Writer marker. No such
// marker is ever cleared to use this new common-upload path.
func (c *agentController) uploadLocalCommonFirstLeafPrivate(
	ctx context.Context, sourceID uint64,
) (client.LocalPushCommonUploadReceipt, error) {
	var zero client.LocalPushCommonUploadReceipt
	if c == nil || c.ctx == nil || c.ctx.Err() != nil || ctx == nil ||
		ctx.Err() != nil || sourceID == 0 || !c.localFolderGrantMu.TryLock() {
		return zero, errLocalBackupFirstFileUnavailable
	}
	defer c.localFolderGrantMu.Unlock()
	workCtx, cancel := context.WithTimeout(ctx, 8*time.Minute)
	defer cancel()

	account, err := userconfig.Load()
	if err != nil || account.SessionInvalid || account.Server == "" ||
		account.Username == "" || account.SessionID == "" {
		return zero, errLocalBackupFirstFileUnavailable
	}
	source, proof, api, err := c.localBoundBackupConfig(workCtx, sourceID)
	if err != nil || api == nil || source.ID != sourceID ||
		source.SyncMode != meta.SourceSyncModeBackup ||
		source.TargetNodeID == nil || *source.TargetNodeID == 0 {
		return zero, errLocalBackupFirstFileUnavailable
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return zero, errLocalBackupFirstFileUnavailable
	}
	key, err := currentLocalFirstFileDeviceKey(account, sourceID)
	if err != nil {
		return zero, errLocalBackupFirstFileUnavailable
	}
	legacyPresent, legacyErr := localFirstFileDurableClaimPresent(workCtx, configDir, key)
	if legacyErr != nil || legacyPresent {
		return zero, errLocalBackupFirstFileUnavailable
	}
	grant, err := localpush.LoadRootGrant(configDir, account.Server,
		account.Username, proof.RootID)
	if err != nil || !grant.StrongIdentity || grant.SourceID != sourceID ||
		grant.Server != account.Server || grant.Account != account.Username ||
		grant.DeviceID != proof.DeviceID || grant.RootID != proof.RootID ||
		grant.Fingerprint != proof.RootFingerprint {
		return zero, errLocalBackupFirstFileUnavailable
	}
	if err := localpushstage.RequireFreshLocalOriginalStageScope(workCtx,
		configDir, grant); err != nil {
		return zero, errLocalBackupFirstFileUnavailable
	}
	rules, err := api.LocalBoundRules(workCtx, sourceID, proof)
	if err != nil || rules.SourceID != sourceID || rules.Revision != source.Revision {
		return zero, errLocalBackupFirstFileUnavailable
	}
	matcher, err := sourcepkg.CompileIgnoreRules(rules.IgnoreRules)
	if err != nil {
		return zero, errLocalBackupFirstFileUnavailable
	}

	// Only the first permitted, top-level strong single-link file is staged
	// as a v2 Plan. Later iterations must replace this with the durable
	// multi-file planner and exact new/overwrite target decision.
	var selected localpush.InventoryItem
	found := false
	snapshot, err := localpush.StreamVerifiedInventoryJournal(
		workCtx, configDir, grant, localpush.DefaultInventoryBatchSize,
		func(items []localpush.InventoryItem) error {
			for _, item := range items {
				if !eligibleLocalBackupFirstLeaf(item) ||
					matcher.Ignored(item.Path, false) {
					continue
				}
				if !found || item.Path < selected.Path {
					selected, found = item, true
				}
			}
			return workCtx.Err()
		})
	if err != nil || !found || snapshot.MissingInferenceSafe ||
		snapshot.SnapshotSHA256 == "" {
		return zero, errLocalBackupFirstFileUnavailable
	}
	latestRules, err := api.LocalBoundRules(workCtx, sourceID, proof)
	if err != nil || latestRules.SourceID != sourceID ||
		latestRules.Revision != source.Revision ||
		latestRules.IgnoreRules != rules.IgnoreRules ||
		localBackupRuleSessionUnchanged(account) != nil {
		return zero, errLocalBackupFirstFileUnavailable
	}
	// A new-file target is deliberately conservative: an existing remote
	// name must fail ordinary upload conflict preflight, not silently skip,
	// overwrite or mint another Operation ID. Descendant paths are not yet
	// authorized by the Server and are never selected here.
	target := localpushcommon.Target{
		ParentID: *source.TargetNodeID, Name: selected.Path,
	}
	plan, err := localpush.PrepareVerifiedCommonUploadPlan(workCtx, configDir,
		grant, account.SessionID, source.Revision, snapshot.SnapshotSHA256,
		selected.Path, target)
	if err != nil {
		return zero, errLocalBackupFirstFileUnavailable
	}
	receipt, runErr := localpush.UploadVerifiedCommonNativeOne(workCtx,
		configDir, grant, snapshot.SnapshotSHA256, plan, api, proof, nil)
	if localBackupRuleSessionUnchanged(account) != nil {
		// Remote commit may exist even when local login changed after HTTP.
		return zero, localpushcommon.ErrUncertain
	}
	if runErr != nil {
		return zero, runErr
	}
	return receipt, nil
}
