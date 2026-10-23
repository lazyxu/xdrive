//go:build linux || windows

package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// CloudLocalBoundBackupCommonBatchHistory is an owning-Agent, read-only
// projection of bounded local attempts. It never exposes a Root/filename,
// grants replay authority, or fabricates Server SyncRun success.
func (c *agentController) CloudLocalBoundBackupCommonBatchHistory(
	ctx context.Context, sourceID uint64,
) (localBackupCommonBatchHistoryPage, error) {
	empty := localBackupCommonBatchHistoryPage{}
	if c == nil || ctx == nil || ctx.Err() != nil || sourceID == 0 {
		return empty, errLocalBackupCommonBatchUnavailable
	}
	account, err := userconfig.Load()
	if err != nil || account.SessionInvalid || account.Server == "" ||
		account.Username == "" || account.SessionID == "" {
		return empty, errLocalBackupCommonBatchUnavailable
	}
	source, proof, api, err := c.localBoundBackupConfig(ctx, sourceID)
	if err != nil || api == nil || source.ID != sourceID ||
		source.SyncMode != meta.SourceSyncModeBackup ||
		source.TargetNodeID == nil || *source.TargetNodeID == 0 {
		return empty, errLocalBackupCommonBatchUnavailable
	}
	dir, err := userconfig.Dir()
	if err != nil {
		return empty, errLocalBackupCommonBatchUnavailable
	}
	grant, err := localpush.LoadRootGrant(dir, account.Server, account.Username, proof.RootID)
	if err != nil || !grant.StrongIdentity || grant.SourceID != sourceID ||
		grant.Server != account.Server || grant.Account != account.Username ||
		grant.DeviceID != proof.DeviceID || grant.RootID != proof.RootID ||
		grant.Fingerprint != proof.RootFingerprint {
		return empty, errLocalBackupCommonBatchUnavailable
	}
	records, err := localpush.ListVerifiedCommonBatchHistory(ctx, dir, grant, account.SessionID)
	if err != nil || localBackupRuleSessionUnchanged(account) != nil {
		return empty, errLocalBackupCommonBatchUnavailable
	}
	out := localBackupCommonBatchHistoryPage{
		SourceID: sourceID,
		Items:    make([]localBackupCommonBatchHistoryItem, 0, len(records)),
	}
	for _, cp := range records {
		if ctx.Err() != nil || cp.SourceID != sourceID ||
			cp.BackupComplete || cp.RetirementSafe || cp.CurrentCASVerified {
			return empty, errLocalBackupCommonBatchUnavailable
		}
		out.Items = append(out.Items, localBackupCommonBatchHistoryItem{
			RunID: cp.RunID, SourceID: cp.SourceID,
			Revision: cp.SourceRevision, State: cp.State,
			InspectedFiles: cp.InspectedFiles,
			ConfirmedFiles: cp.ConfirmedFiles, SkippedFiles: cp.SkippedFiles,
			UnsupportedFiles: cp.UnsupportedFiles, UncertainFiles: cp.UncertainFiles,
			ConfirmedBytes: cp.ConfirmedBytes,
			StartedAt:      cp.StartedAt, FinishedAt: cp.UpdatedAt,
		})
	}
	return out, nil
}
