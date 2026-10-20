package main

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushrunner"
	"github.com/lazyxu/xdrive/internal/localpushwriter"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// A one-shot, owning-Desktop first-file observation, NOT a completed backup.
// Private paths, Root/Stage IDs, request secrets and hashes never reach IPC.
type localBackupFirstFileSummary struct {
	SourceID         uint64 `json:"source_id"`
	Revision         uint64 `json:"revision"`
	ObservedFiles    int    `json:"observed_files"`
	ObservedBytes    int64  `json:"observed_bytes"`
	PhysicalObserved bool   `json:"physical_observed"`
	BackupComplete   bool   `json:"backup_complete"`
	RetirementSafe   bool   `json:"retirement_safe"`
}

var errLocalBackupFirstFileUnavailable = errors.New("本机首文件上传不可用：请检查授权与完整扫描清单，或核查是否已有不确定上传；不要重复提交")

func safeLocalBackupFirstFileError(err error) error {
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return errLocalBackupFirstFileUnavailable
}

// Never choose a nested, ignored, hardlinked, weak or oversized original.
func eligibleLocalBackupFirstLeaf(item localpush.InventoryItem) bool {
	return item.Kind == "file" && !item.Ignored &&
		localPushFirstLeafNameValid(item.Path) &&
		item.Size >= 0 && item.Size <= localpushrunner.MaxFirstLeafBytes &&
		item.ModifiedAt != nil && item.NativeIdentity != nil &&
		item.NativeIdentity.Strong && item.NativeIdentity.LinkCount == 1 &&
		item.NativeIdentity.RenameCandidate
}

// CloudStartLocalBoundBackupFirstFile is explicitly manual, owning-Agent-only
// and currently ONE-SHOT per Source. A stale Stage or request-key claim blocks
// another upload even after a successful first-file observation.
func (c *agentController) cloudStartLocalBoundBackupFirstFileOnce(
	ctx context.Context, sourceID uint64,
) (localBackupFirstFileSummary, error) {
	var empty localBackupFirstFileSummary
	if c == nil || ctx == nil || ctx.Err() != nil || sourceID == 0 ||
		!c.localFolderGrantMu.TryLock() {
		return empty, errLocalBackupFirstFileUnavailable
	}
	defer c.localFolderGrantMu.Unlock()

	workCtx, cancel := context.WithTimeout(ctx, 8*time.Minute)
	defer cancel()
	account, err := userconfig.Load()
	if err != nil || account.SessionInvalid || account.Server == "" ||
		account.Username == "" || account.SessionID == "" {
		return empty, safeLocalBackupFirstFileError(err)
	}
	source, proof, cli, err := c.localBoundBackupConfig(workCtx, sourceID)
	if err != nil || cli == nil || source.ID != sourceID ||
		source.SyncMode != meta.SourceSyncModeBackup ||
		source.TargetNodeID == nil || *source.TargetNodeID == 0 {
		return empty, errLocalBackupFirstFileUnavailable
	}
	rules, err := cli.LocalBoundRules(workCtx, sourceID, proof)
	if err != nil || rules.SourceID != sourceID || rules.Revision != source.Revision {
		return empty, errLocalBackupFirstFileUnavailable
	}
	matcher, err := sourcepkg.CompileIgnoreRules(rules.IgnoreRules)
	if err != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	grant, err := localpush.LoadRootGrant(configDir, account.Server, account.Username, proof.RootID)
	if err != nil || !grant.StrongIdentity || grant.Server != account.Server ||
		grant.Account != account.Username || grant.SourceID != sourceID ||
		grant.DeviceID != proof.DeviceID || grant.RootID != proof.RootID ||
		grant.Fingerprint != proof.RootFingerprint {
		return empty, errLocalBackupFirstFileUnavailable
	}

	var selected localpush.InventoryItem
	found := false
	// Only keep one lexicographically first eligible file in memory; the
	// entire local manifest must pass independent verification first.
	_, err = localpush.StreamVerifiedInventoryJournal(workCtx, configDir, grant,
		localpush.DefaultInventoryBatchSize, func(items []localpush.InventoryItem) error {
			for _, item := range items {
				if !eligibleLocalBackupFirstLeaf(item) || matcher.Ignored(item.Path, false) {
					continue
				}
				if !found || item.Path < selected.Path {
					selected = item
					found = true
				}
			}
			return workCtx.Err()
		})
	if err != nil || !found {
		return empty, safeLocalBackupFirstFileError(err)
	}
	// Open and hash the genuine strong-identity OS file, never accept a
	// path, size, hash or item identity supplied by the renderer.
	digest, err := localpush.HashVerifiedInventoryFile(workCtx, grant, selected, nil)
	if err != nil || digest.Path != selected.Path || digest.Size != selected.Size ||
		digest.NativeIdentityKey != selected.NativeIdentity.Key || len(digest.SHA256) != 64 {
		return empty, safeLocalBackupFirstFileError(err)
	}
	latestRules, err := cli.LocalBoundRules(workCtx, sourceID, proof)
	if err != nil || latestRules.SourceID != sourceID ||
		latestRules.Revision != source.Revision ||
		latestRules.IgnoreRules != rules.IgnoreRules ||
		localBackupRuleSessionUnchanged(account) != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	driver, err := c.newLocalPushFirstLeafDriverPrivate(
		workCtx, sourceID, digest.Path, digest.SHA256, digest.Size)
	if err != nil || driver.scope.Revision != source.Revision ||
		driver.scope.TargetNodeID != *source.TargetNodeID ||
		driver.proof != proof || driver.grant != grant {
		return empty, errLocalBackupFirstFileUnavailable
	}
	// Preserve all original owning-Agent, native Root, Source and OS-key
	// preconditions BEFORE making a never-reused disk writer claim. The claim
	// adds cross-process admission fencing; it grants no new Server authority.
	if err := driver.Check(workCtx, driver.scope); err != nil {
		return empty, safeLocalBackupFirstFileError(err)
	}
	writerScope, err := localpushwriter.NewScope(
		configDir, grant.Path, account.Server, account.Username, account.SessionID,
		proof.DeviceID, proof.RootID, proof.RootFingerprint, sourceID, source.Revision,
		*source.TargetNodeID, digest.NativeIdentityKey, digest.SHA256)
	if err != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	// O_EXCL + Linux flock / Windows LockFileEx MUST precede real HTTP Stage,
	// and the same live lock is held through exact SQL/CAS/native reconciliation.
	writer, err := localpushwriter.Begin(workCtx, writerScope)
	if err != nil {
		return empty, safeLocalBackupFirstFileError(err)
	}
	defer writer.Close()
	// Existing native Stage -> authenticated HTTP/CAS/SQL -> independently
	// native-held historical SQL/physical CAS path. Ambiguity quarantines
	// the original Stage/key; NO retry, key retirement or SourceRun.
	outcome, runErr := (&localpushrunner.Runner{}).RunFirstLeaf(workCtx, driver.scope, driver)
	// Close releases ONLY the live OS lock after reconciliation. The permanent
	// marker is NEVER removed, even on a positive physical observation.
	closeErr := writer.Close()
	if runErr != nil || closeErr != nil || !outcome.Confirmed || outcome.Uncertain {
		return empty, safeLocalBackupFirstFileError(runErr)
	}
	return localBackupFirstFileSummary{
		SourceID: sourceID, Revision: source.Revision,
		ObservedFiles: 1, ObservedBytes: digest.Size,
		PhysicalObserved: true, BackupComplete: false, RetirementSafe: false,
	}, nil
}
