package main

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// Owning-Desktop-only bounded advisory evidence summary. No path, Root,
// SourceItem, native filesystem identity or device credential may enter IPC.
type localBackupEvidenceStageSummary struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	Hints                int64  `json:"hints"`
	Matched              int64  `json:"matched"`
	Unmatched            int64  `json:"unmatched"`
	Stored               int64  `json:"stored"`
	Replayed             int64  `json:"replayed"`
	Complete             bool   `json:"complete"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

// The owning Agent alone owns the credential and Root. This explicit request
// ONLY stages revocable/immutable advisory metadata, never cloud operations.
func (c *agentController) CloudStageLocalBoundBackupEvidence(
	ctx context.Context, sourceID uint64,
) (localBackupEvidenceStageSummary, error) {
	var empty localBackupEvidenceStageSummary
	if ctx == nil || sourceID == 0 {
		return empty, privateLocalSnapshotError(errors.New("valid local Source required"))
	}
	stageCtx, cancel := context.WithTimeout(ctx, 300*time.Second)
	defer cancel()
	if !c.localFolderGrantMu.TryLock() {
		return empty, privateLocalSnapshotError(errors.New("owning Agent operation busy"))
	}
	defer c.localFolderGrantMu.Unlock()

	cfg, err := userconfig.Load()
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	source, proof, cli, err := c.localBoundBackupConfig(stageCtx, sourceID)
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	rules, err := cli.LocalBoundRules(stageCtx, sourceID, proof)
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
		stageCtx, configDir, grant, source.Revision); err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	result, err := localpushstage.StageVerifiedLocalRenameEvidence(
		cli, stageCtx, configDir, grant, source.Revision, proof)
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	latest, err := cli.LocalBoundRules(stageCtx, sourceID, proof)
	if err != nil || latest.SourceID != sourceID || latest.Revision != source.Revision ||
		latest.IgnoreRules != rules.IgnoreRules ||
		localBackupRuleSessionUnchanged(cfg) != nil {
		// Provisional evidence may remain on Server, but it cannot grant
		// SourceItem/Run authority even if a later revocation wins this race.
		return empty, privateLocalSnapshotError(errors.New("owning device or rules changed"))
	}
	if err := stageCtx.Err(); err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	return localBackupEvidenceStageSummary{
		SourceID: sourceID, Revision: source.Revision,
		Hints: result.Hints, Matched: result.Matched,
		Unmatched: result.Unmatched, Stored: result.Stored, Replayed: result.Replayed,
		Complete: true, Authoritative: false, MissingInferenceSafe: false,
	}, nil
}
