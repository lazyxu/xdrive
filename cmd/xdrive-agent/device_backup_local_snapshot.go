package main

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// An owning Desktop may explicitly save a LOCAL inventory generation.
// No filename, OS path, Root identity or Source credential reaches Renderer.
type localBackupSnapshotSummary struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	ScannedFiles         int64  `json:"scanned_files"`
	ScannedDirectories   int64  `json:"scanned_directories"`
	ScannedBytes         int64  `json:"scanned_bytes"`
	IgnoredItems         int64  `json:"ignored_items"`
	IgnoredBytes         int64  `json:"ignored_bytes"`
	SkippedUnsafeItems   int64  `json:"skipped_unsafe_items"`
	HasVerifiedPrevious  bool   `json:"has_verified_previous"`
	Saved                bool   `json:"saved"`
	Complete             bool   `json:"complete"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

func privateLocalSnapshotError(err error) error {
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return errors.New("local inventory save unavailable: verify owning device, Root and Source authorization")
}

// CloudSaveLocalBoundBackupSnapshot performs an EXPLICIT local-only metadata
// scan. CURRENT/PREVIOUS generations are written with the existing crash-safe
// journal protocol, never to SourceItem/Node/CAS or a SourceRun. A completed
// local snapshot is NOT permission to infer remote deletion.
func (c *agentController) CloudSaveLocalBoundBackupSnapshot(ctx context.Context, sourceID uint64) (localBackupSnapshotSummary, error) {
	var empty localBackupSnapshotSummary
	if ctx == nil || sourceID == 0 {
		return empty, errors.New("positive Source and context required")
	}
	c.localFolderGrantMu.Lock()
	defer c.localFolderGrantMu.Unlock()
	scanCtx, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()

	cfg, err := userconfig.Load()
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	source, proof, cli, err := c.localBoundBackupConfig(scanCtx, sourceID)
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	rules, err := cli.LocalBoundRules(scanCtx, sourceID, proof)
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

	// Prepare the incomplete snapshot first; any canceled, partial or stale
	// scan aborts the writer without advancing CURRENT/PREVIOUS.
	writer, err := localpush.BeginInventoryJournal(configDir, grant)
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	defer writer.Abort()
	scanner := localpush.InventoryScanner{
		IgnoreRules: rules.IgnoreRules, BatchSize: localpush.DefaultInventoryBatchSize,
		IncludeNativeIdentity: true,
	}
	stats, err := scanner.ScanInventory(scanCtx, grant, writer.Append)
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	if !stats.Complete || stats.MissingInferenceSafe {
		return empty, privateLocalSnapshotError(errors.New("partial or unsafe inventory"))
	}
	// The private GET rechecks the device credential, Root and exact Source
	// revision on Server, including revocation. Never use generic Source GET.
	recheck := func() error {
		latest, err := cli.LocalBoundRules(scanCtx, sourceID, proof)
		if err != nil || latest.SourceID != sourceID || latest.Revision != source.Revision ||
			latest.IgnoreRules != rules.IgnoreRules {
			return errors.New("owning Agent authorization or rules changed")
		}
		if err := localBackupRuleSessionUnchanged(cfg); err != nil {
			return err
		}
		return scanCtx.Err()
	}
	if err := recheck(); err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	snapshot, err := writer.Commit(stats)
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	// As a local-only artifact the completed journal may remain on disk if a
	// revocation/account change races the final read; it never grants a
	// remote write. Do not report success when the final recheck fails.
	if err := recheck(); err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	verified, err := localpush.VerifyInventoryJournal(scanCtx, configDir, grant)
	if err != nil || verified.SnapshotName != snapshot.SnapshotName ||
		verified.SnapshotSHA256 != snapshot.SnapshotSHA256 ||
		verified.Items != snapshot.Items {
		return empty, privateLocalSnapshotError(errors.New("saved inventory verification failed"))
	}
	previous, prevErr := localpush.VerifyPreviousInventoryJournal(scanCtx, configDir, grant)
	if err := scanCtx.Err(); err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	return localBackupSnapshotSummary{
		SourceID: sourceID, Revision: source.Revision,
		ScannedFiles: stats.ScannedFiles, ScannedDirectories: stats.ScannedDirectories,
		ScannedBytes: stats.ScannedBytes, IgnoredItems: stats.IgnoredItems,
		IgnoredBytes: stats.IgnoredBytes, SkippedUnsafeItems: stats.SkippedUnsafeItems,
		HasVerifiedPrevious: prevErr == nil && previous.SnapshotName != snapshot.SnapshotName,
		Saved:               true, Complete: true, MissingInferenceSafe: false,
	}, nil
}
