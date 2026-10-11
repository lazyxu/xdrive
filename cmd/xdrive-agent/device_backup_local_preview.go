package main

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// Owning-Agent-only completed preview. Never serialize local paths, items,
// Root fingerprints, credentials, or raw filesystem failures to Renderer.
type localBackupPreviewSummary struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	ScannedFiles         int64  `json:"scanned_files"`
	ScannedDirectories   int64  `json:"scanned_directories"`
	ScannedBytes         int64  `json:"scanned_bytes"`
	IgnoredItems         int64  `json:"ignored_items"`
	IgnoredBytes         int64  `json:"ignored_bytes"`
	SkippedUnsafeItems   int64  `json:"skipped_unsafe_items"`
	Complete             bool   `json:"complete"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

func privateLocalPreviewError(err error) error {
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return errors.New("local preview unavailable: check owning device, Root and Source authorization")
}

// CloudLocalBoundBackupPreview scans approved Root metadata only. No file
// body reads, journals, SourceRun, CAS writes or Mirror deletion evidence.
// Cancelling Electron HTTP fetch propagates to scanner via Request.Context.
func (c *agentController) CloudLocalBoundBackupPreview(ctx context.Context, sourceID uint64) (localBackupPreviewSummary, error) {
	var empty localBackupPreviewSummary
	if ctx == nil || sourceID == 0 {
		return empty, errors.New("valid local preview context and Source required")
	}
	c.localFolderGrantMu.Lock()
	defer c.localFolderGrantMu.Unlock()
	scanCtx, cancel := context.WithTimeout(ctx, 35*time.Second)
	defer cancel()
	cfg, err := userconfig.Load()
	if err != nil {
		return empty, privateLocalPreviewError(err)
	}
	source, proof, cli, err := c.localBoundBackupConfig(scanCtx, sourceID)
	if err != nil {
		return empty, privateLocalPreviewError(err)
	}
	// Source read DTO deliberately redacts the real local ignore rules.
	rules, err := cli.LocalBoundRules(scanCtx, sourceID, proof)
	if err != nil || rules.SourceID != sourceID || rules.Revision != source.Revision {
		return empty, privateLocalPreviewError(errors.New("private ignore rules or Source revision changed"))
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, privateLocalPreviewError(err)
	}
	grant, err := localpush.LoadRootGrant(configDir, cfg.Server, cfg.Username, proof.RootID)
	if err != nil || grant.SourceID != sourceID || grant.RootID != proof.RootID ||
		grant.DeviceID != proof.DeviceID || grant.Fingerprint != proof.RootFingerprint {
		return empty, privateLocalPreviewError(errors.New("Root grant is missing or mismatched"))
	}
	scanner := localpush.InventoryScanner{IgnoreRules: rules.IgnoreRules, BatchSize: localpush.DefaultInventoryBatchSize}
	stats, err := scanner.ScanInventory(scanCtx, grant, func([]localpush.InventoryItem) error {
		return scanCtx.Err()
	})
	if err != nil {
		return empty, privateLocalPreviewError(err)
	}
	// A token revoke, rule update, Source revision change or account switch
	// during the scan must not publish a successful preview.
	rechecked, err := cli.LocalBoundRules(scanCtx, sourceID, proof)
	if err != nil || rechecked.SourceID != sourceID || rechecked.Revision != source.Revision ||
		rechecked.IgnoreRules != rules.IgnoreRules || !stats.Complete || stats.MissingInferenceSafe {
		return empty, privateLocalPreviewError(errors.New("preview evidence or authorization changed"))
	}
	if err := localBackupRuleSessionUnchanged(cfg); err != nil {
		return empty, privateLocalPreviewError(err)
	}
	if err := scanCtx.Err(); err != nil {
		return empty, privateLocalPreviewError(err)
	}
	return localBackupPreviewSummary{
		SourceID: sourceID, Revision: source.Revision,
		ScannedFiles: stats.ScannedFiles, ScannedDirectories: stats.ScannedDirectories,
		ScannedBytes: stats.ScannedBytes, IgnoredItems: stats.IgnoredItems,
		IgnoredBytes: stats.IgnoredBytes, SkippedUnsafeItems: stats.SkippedUnsafeItems,
		Complete: true, MissingInferenceSafe: false,
	}, nil
}
