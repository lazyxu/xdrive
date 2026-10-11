package main

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// Own-device advisory counts from two complete, verified LOCAL journals.
// No item path, OS path, Root identity or raw error leaves the Agent.
type localBackupDeltaSummary struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	PreviousItems        int64  `json:"previous_items"`
	CurrentItems         int64  `json:"current_items"`
	Added                int64  `json:"added"`
	Changed              int64  `json:"changed"`
	MetadataStable       int64  `json:"metadata_stable"`
	AbsentCandidates     int64  `json:"absent_candidates"`
	Complete             bool   `json:"complete"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

// CloudLocalBoundBackupDelta reads local snapshots only. It neither produces
// SourceRun/SourceItem writes nor establishes cloud deletion evidence.
func (c *agentController) CloudLocalBoundBackupDelta(ctx context.Context, sourceID uint64) (localBackupDeltaSummary, error) {
	var empty localBackupDeltaSummary
	if ctx == nil || sourceID == 0 {
		return empty, privateLocalSnapshotError(errors.New("valid Source and context required"))
	}
	// Do not queue behind another potentially lengthy local scan.
	if !c.localFolderGrantMu.TryLock() {
		return empty, privateLocalSnapshotError(errors.New("owning Agent local operation busy"))
	}
	defer c.localFolderGrantMu.Unlock()
	deltaCtx, cancel := context.WithTimeout(ctx, 150*time.Second)
	defer cancel()

	cfg, err := userconfig.Load()
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	source, proof, cli, err := c.localBoundBackupConfig(deltaCtx, sourceID)
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	rules, err := cli.LocalBoundRules(deltaCtx, sourceID, proof)
	if err != nil || rules.SourceID != sourceID || rules.Revision != source.Revision {
		return empty, privateLocalSnapshotError(errors.New("private rules or Source revision changed"))
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	grant, err := localpush.LoadRootGrant(configDir, cfg.Server, cfg.Username, proof.RootID)
	if err != nil || grant.SourceID != sourceID || grant.RootID != proof.RootID ||
		grant.DeviceID != proof.DeviceID || grant.Fingerprint != proof.RootFingerprint {
		return empty, privateLocalSnapshotError(errors.New("Root grant unavailable or changed"))
	}

	// Private, bounded hashed buckets; candidate rows never reach IPC.
	delta, err := localpush.StreamInventoryGenerationDelta(
		deltaCtx, configDir, grant, localpush.DefaultInventoryBatchSize,
		func([]localpush.InventoryDeltaCandidate) error { return deltaCtx.Err() },
	)
	if err != nil || delta.MissingInferenceSafe {
		return empty, privateLocalSnapshotError(errors.New("two complete verified generations required"))
	}
	latest, err := cli.LocalBoundRules(deltaCtx, sourceID, proof)
	if err != nil || latest.SourceID != sourceID || latest.Revision != source.Revision ||
		latest.IgnoreRules != rules.IgnoreRules {
		return empty, privateLocalSnapshotError(errors.New("owning device authorization or rules changed"))
	}
	if err := localBackupRuleSessionUnchanged(cfg); err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	if err := deltaCtx.Err(); err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	return localBackupDeltaSummary{
		SourceID: sourceID, Revision: source.Revision,
		PreviousItems: delta.Previous.Items, CurrentItems: delta.Current.Items,
		Added: delta.Added, Changed: delta.Changed,
		MetadataStable: delta.MetadataStable, AbsentCandidates: delta.AbsentCandidates,
		Complete: true, Authoritative: false, MissingInferenceSafe: false,
	}, nil
}
