package main

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// cloudStageLocalRenameEvidence is an owning-Agent-private preparation step.
// It is intentionally NOT an Agent HTTP/IPC or Desktop/renderer operation.
// It stages ONLY provisional, non-authoritative metadata: never activation,
// upload, SourceItem/alias mutation, Node moves or Mirror missing evidence.
func (c *agentController) cloudStageLocalRenameEvidence(
	ctx context.Context, sourceID uint64,
) (localpushstage.LocalVerifiedRenameStageSummary, error) {
	var empty localpushstage.LocalVerifiedRenameStageSummary
	if ctx == nil || sourceID == 0 {
		return empty, privateLocalSnapshotError(errors.New("valid local Source required"))
	}
	if !c.localFolderGrantMu.TryLock() {
		return empty, privateLocalSnapshotError(errors.New("owning Agent operation busy"))
	}
	defer c.localFolderGrantMu.Unlock()

	cfg, err := userconfig.Load()
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	source, proof, cli, err := c.localBoundBackupConfig(ctx, sourceID)
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	rules, err := cli.LocalBoundRules(ctx, sourceID, proof)
	if err != nil || rules.SourceID != sourceID || rules.Revision != source.Revision {
		return empty, privateLocalSnapshotError(errors.New("local rules or Source revision changed"))
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	grant, err := localpush.LoadRootGrant(configDir, cfg.Server, cfg.Username, proof.RootID)
	if err != nil || grant.SourceID != sourceID || grant.DeviceID != proof.DeviceID ||
		grant.RootID != proof.RootID || grant.Fingerprint != proof.RootFingerprint {
		return empty, privateLocalSnapshotError(errors.New("owning Root grant invalid"))
	}
	if _, err := localpush.PublishLocalReconcileEvidence(
		ctx, configDir, grant, source.Revision); err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	result, err := localpushstage.StageVerifiedLocalRenameEvidence(
		cli, ctx, configDir, grant, source.Revision, proof)
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	latest, err := cli.LocalBoundRules(ctx, sourceID, proof)
	if err != nil || latest.SourceID != sourceID || latest.Revision != source.Revision ||
		latest.IgnoreRules != rules.IgnoreRules ||
		localBackupRuleSessionUnchanged(cfg) != nil {
		// Provisional evidence may remain on Server, but it cannot grant
		// SourceItem/Run authority even if a later revocation wins this race.
		return empty, privateLocalSnapshotError(errors.New("owning device or rules changed"))
	}
	return result, nil
}
