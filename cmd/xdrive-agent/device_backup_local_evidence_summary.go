package main

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// This owning-Agent-only readback is NOT yet a Desktop HTTP/IPC operation.
// It cannot promote an alias or infer any cloud deletion.
type localBackupPersistedEvidenceSummary struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	StagedRecords        int64  `json:"staged_records"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

func (c *agentController) CloudReadLocalBoundBackupEvidenceSummary(
	ctx context.Context, sourceID uint64,
) (localBackupPersistedEvidenceSummary, error) {
	var empty localBackupPersistedEvidenceSummary
	if ctx == nil || sourceID == 0 {
		return empty, privateLocalSnapshotError(errors.New("valid local Source required"))
	}
	if !c.localFolderGrantMu.TryLock() {
		return empty, privateLocalSnapshotError(errors.New("owning Agent busy"))
	}
	defer c.localFolderGrantMu.Unlock()
	readCtx, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()
	cfg, err := userconfig.Load()
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	source, proof, cli, err := c.localBoundBackupConfig(readCtx, sourceID)
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	rules, err := cli.LocalBoundRules(readCtx, sourceID, proof)
	if err != nil || rules.SourceID != sourceID || rules.Revision != source.Revision {
		return empty, privateLocalSnapshotError(errors.New("local rules or revision changed"))
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	grant, err := localpush.LoadRootGrant(configDir, cfg.Server, cfg.Username, proof.RootID)
	if err != nil || grant.SourceID != sourceID || grant.DeviceID != proof.DeviceID ||
		grant.RootID != proof.RootID || grant.Fingerprint != proof.RootFingerprint {
		return empty, privateLocalSnapshotError(errors.New("owning Root grant changed"))
	}
	evidence, err := localpush.LoadLocalReconcileEvidence(readCtx, configDir, grant, source.Revision)
	if err != nil || evidence.Authoritative || evidence.MissingInferenceSafe {
		return empty, privateLocalSnapshotError(errors.New("verified local generation unavailable"))
	}
	saved, err := cli.ReadLocalSourceItemEvidenceSummary(
		readCtx, sourceID, source.Revision, proof, evidence.PreviousSHA256, evidence.CurrentSHA256)
	if err != nil || saved.Authoritative || saved.MissingInferenceSafe {
		return empty, privateLocalSnapshotError(errors.New("Server evidence count unavailable"))
	}
	latest, err := localpush.LoadLocalReconcileEvidence(readCtx, configDir, grant, source.Revision)
	if err != nil || latest.IntegritySHA256 != evidence.IntegritySHA256 {
		return empty, privateLocalSnapshotError(errors.New("private inventory rotated during read"))
	}
	rulesNow, err := cli.LocalBoundRules(readCtx, sourceID, proof)
	if err != nil || rulesNow.SourceID != sourceID || rulesNow.Revision != source.Revision ||
		rulesNow.IgnoreRules != rules.IgnoreRules ||
		localBackupRuleSessionUnchanged(cfg) != nil || readCtx.Err() != nil {
		return empty, privateLocalSnapshotError(errors.New("owning Agent authentication changed"))
	}
	return localBackupPersistedEvidenceSummary{
		SourceID: sourceID, Revision: source.Revision,
		StagedRecords: saved.StagedRecords, Authoritative: false, MissingInferenceSafe: false,
	}, nil
}
