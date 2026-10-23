//go:build linux || windows

package main

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
	"github.com/lazyxu/xdrive/internal/localpushqueue"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// localCommonQueueSummary is historical per-file evidence. It is not a
// current-CAS proof, a SourceRun success, or permission to clear old claims.
type localCommonQueueSummary struct {
	SourceID            uint64 `json:"source_id"`
	Revision            uint64 `json:"revision"`
	Candidates          int64  `json:"candidates"`
	Unsupported         int64  `json:"unsupported"`
	CommittedNow        int64  `json:"committed_now"`
	HistoricalRechecked int64  `json:"historical_rechecked"`
	BackupComplete      bool   `json:"backup_complete"`
	CurrentCASVerified  bool   `json:"current_cas_verified"`
	RetirementSafe      bool   `json:"retirement_safe"`
}

// runLocalCommonQueuePrivate is the Agent's SOURCE-OWNED integration of a
// fully-verified local inventory -> durable queue -> original Plan ->
// existing ordinary /uploads transport -> original immutable SQL receipt.
// The path remains private and intentionally UNROUTED from Desktop IPC until
// a real cross-process single-Source execution lease and repeat-generation
// reconciliation are in place. Do not substitute it for the enabled legacy
// one-shot Stage first-file upload.
func (c *agentController) runLocalCommonQueuePrivate(
	ctx context.Context, sourceID uint64,
) (localCommonQueueSummary, error) {
	var empty localCommonQueueSummary
	if c == nil || ctx == nil || ctx.Err() != nil || c.ctx == nil ||
		c.ctx.Err() != nil || sourceID == 0 || !c.localFolderGrantMu.TryLock() {
		return empty, errLocalBackupFirstFileUnavailable
	}
	defer c.localFolderGrantMu.Unlock()

	workCtx, cancel := context.WithTimeout(ctx, 8*time.Minute)
	defer cancel()
	account, err := userconfig.Load()
	if err != nil || account.SessionInvalid || account.Server == "" ||
		account.Username == "" || account.SessionID == "" {
		return empty, errLocalBackupFirstFileUnavailable
	}
	source, proof, api, err := c.localBoundBackupConfig(workCtx, sourceID)
	if err != nil || api == nil || source.ID != sourceID ||
		source.SyncMode != meta.SourceSyncModeBackup ||
		source.TargetNodeID == nil || *source.TargetNodeID == 0 {
		return empty, errLocalBackupFirstFileUnavailable
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	key, err := currentLocalFirstFileDeviceKey(account, sourceID)
	if err != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	present, claimErr := localFirstFileDurableClaimPresent(workCtx, configDir, key)
	if claimErr != nil || present {
		return empty, errLocalBackupFirstFileUnavailable
	}
	grant, err := localpush.LoadRootGrant(configDir, account.Server,
		account.Username, proof.RootID)
	if err != nil || !grant.StrongIdentity || grant.SourceID != sourceID ||
		grant.Server != account.Server || grant.Account != account.Username ||
		grant.DeviceID != proof.DeviceID || grant.RootID != proof.RootID ||
		grant.Fingerprint != proof.RootFingerprint {
		return empty, errLocalBackupFirstFileUnavailable
	}
	if err := localpushstage.RequireFreshLocalOriginalStageScope(
		workCtx, configDir, grant); err != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	rules, err := api.LocalBoundRules(workCtx, sourceID, proof)
	if err != nil || rules.SourceID != sourceID ||
		rules.Revision != source.Revision {
		return empty, errLocalBackupFirstFileUnavailable
	}
	matcher, err := sourcepkg.CompileIgnoreRules(rules.IgnoreRules)
	if err != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	snapshot, err := localpush.VerifyInventoryJournal(workCtx, configDir, grant)
	if err != nil || snapshot.SnapshotSHA256 == "" {
		return empty, errLocalBackupFirstFileUnavailable
	}
	scope := localpushqueue.Scope{
		Server: account.Server, Account: account.Username,
		DeviceID: proof.DeviceID, RootID: proof.RootID,
		RootFingerprint: proof.RootFingerprint, SourceID: sourceID,
		SourceRevision: source.Revision, TargetNodeID: *source.TargetNodeID,
		SnapshotSHA256: snapshot.SnapshotSHA256,
	}
	// Reuse only an independently checked, fully committed prior queue as
	// an incremental baseline. PREVIOUS.json alone is a scan, not a backup.
	recheckOriginal := func(readCtx context.Context, item localpushqueue.Task,
		history localpushqueue.Commit) error {
		original, readErr := api.ReadLocalPushCommonUploadReceipt(
			readCtx, sourceID, source.Revision, proof,
			history.OperationID, history.ResumeKey)
		if readErr != nil || !original.Committed ||
			original.OperationID != history.OperationID ||
			original.NodeID != history.NodeID ||
			original.NodeRevision != history.NodeRevision ||
			original.Size != item.Size ||
			original.ContentSHA256 != history.ContentSHA ||
			localBackupRuleSessionUnchanged(account) != nil {
			return localpushcommon.ErrUncertain
		}
		return nil
	}
	useDelta := false
	var previous localpush.InventoryJournalSnapshot
	if candidate, previousErr := localpush.VerifyPreviousInventoryJournal(
		workCtx, configDir, grant); previousErr == nil &&
		candidate.SnapshotName != snapshot.SnapshotName {
		previous = candidate
		oldScope := scope
		oldScope.SnapshotSHA256 = candidate.SnapshotSHA256
		oldQueue, exists, readErr := localpushqueue.OpenIfPresent(
			configDir, oldScope)
		if readErr != nil {
			return empty, localpushcommon.ErrUncertain
		}
		if exists {
			if _, err := oldQueue.RecheckAll(workCtx, recheckOriginal); err != nil {
				// One pending file forbids silently advancing the baseline.
				return empty, localpushcommon.ErrUncertain
			}
			useDelta = true
		}
	}
	var unsupported int64
	queue, err := localpushqueue.Build(workCtx, configDir, scope,
		func(yield func(localpushqueue.Task) error) error {
			if useDelta {
				// Hash-bucket delta uses two independently verified, complete
				// inventories; absent files are NEVER a backup deletion.
				delta, deltaErr := localpush.StreamInventoryGenerationDelta(
					workCtx, configDir, grant, localpush.DefaultInventoryBatchSize,
					func(items []localpush.InventoryDeltaCandidate) error {
						for _, item := range items {
							if item.Kind == localpush.InventoryDeltaStable ||
								item.Kind == localpush.InventoryDeltaAbsent {
								continue
							}
							candidate := item.Current
							if candidate == nil {
								return localpushqueue.ErrQuarantined
							}
							if candidate.Kind != "file" || candidate.Ignored ||
								matcher.Ignored(candidate.Path, false) {
								continue
							}
							if item.Kind == localpush.InventoryDeltaChanged {
								// A' requires a verified prior Node revision and a new
								// per-generation original Plan. Never overwrite by name.
								unsupported++
								continue
							}
							if !localPushFirstLeafNameValid(candidate.Path) ||
								candidate.Size < 0 || candidate.Size > 64<<20 ||
								candidate.ModifiedAt == nil ||
								!candidate.StrongNativeIdentity ||
								candidate.LinkCount != 1 || !candidate.RenameHintSafe {
								unsupported++
								continue
							}
							if err := yield(localpushqueue.Task{
								Path: candidate.Path, Size: candidate.Size,
								NativeIdentityKey: candidate.NativeIdentityKey,
							}); err != nil {
								return err
							}
						}
						return workCtx.Err()
					})
				if deltaErr != nil ||
					delta.Current.SnapshotSHA256 != scope.SnapshotSHA256 ||
					delta.Current.SnapshotName != snapshot.SnapshotName ||
					delta.Previous.SnapshotSHA256 != previous.SnapshotSHA256 ||
					delta.Previous.SnapshotName != previous.SnapshotName {
					return localpushqueue.ErrQuarantined
				}
				return nil
			}
			// No verified previous backup baseline: perform a full verified
			// initial scan. The per-file Plan still prevents a conflicting
			// second upload Operation.
			seen, streamErr := localpush.StreamVerifiedInventoryJournal(
				workCtx, configDir, grant, localpush.DefaultInventoryBatchSize,
				func(items []localpush.InventoryItem) error {
					for _, item := range items {
						if item.Kind != "file" || item.Ignored ||
							matcher.Ignored(item.Path, false) {
							continue
						}
						if !eligibleLocalBackupFirstLeaf(item) {
							unsupported++
							continue
						}
						if err := yield(localpushqueue.Task{
							Path: item.Path, Size: item.Size,
							NativeIdentityKey: item.NativeIdentity.Key,
						}); err != nil {
							return err
						}
					}
					return workCtx.Err()
				})
			if streamErr != nil || seen.SnapshotSHA256 != scope.SnapshotSHA256 ||
				seen.SnapshotName != snapshot.SnapshotName ||
				seen.Items != snapshot.Items {
				return localpushqueue.ErrQuarantined
			}
			return nil
		})
	if err != nil {
		return empty, err
	}
	// No legacy marker was retired or overwritten by planning. A fresh
	// Source rules/session check precedes any requested file upload.
	fresh, err := api.LocalBoundRules(workCtx, sourceID, proof)
	if err != nil || fresh.SourceID != sourceID ||
		fresh.Revision != source.Revision ||
		fresh.IgnoreRules != rules.IgnoreRules ||
		localBackupRuleSessionUnchanged(account) != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	stats, runErr := queue.Run(workCtx,
		func(fileCtx context.Context, item localpushqueue.Task) (localpushqueue.Commit, error) {
			var zero localpushqueue.Commit
			if localBackupRuleSessionUnchanged(account) != nil {
				return zero, localpushcommon.ErrUncertain
			}
			// Only the existing persisted per-file Plan may mint/replay the
			// Operation. The renderer never chooses a path, key or target.
			target := localpushcommon.Target{
				ParentID: *source.TargetNodeID, Name: item.Path,
			}
			plan, err := localpush.PrepareVerifiedCommonUploadPlan(
				fileCtx, configDir, grant, account.SessionID, source.Revision,
				scope.SnapshotSHA256, item.Path, target)
			if err != nil || plan.Size != item.Size ||
				plan.NativeIdentityKey != item.NativeIdentityKey {
				return zero, localpushcommon.ErrUncertain
			}
			receipt, err := localpush.UploadVerifiedCommonNativeOne(
				fileCtx, configDir, grant, scope.SnapshotSHA256,
				plan, api, proof, nil)
			if err != nil || !receipt.Committed ||
				receipt.OperationID != plan.OperationID ||
				receipt.SourceID != sourceID || receipt.Revision != source.Revision ||
				receipt.ContentSHA256 != plan.ContentSHA256 ||
				receipt.Size != item.Size {
				return zero, localpushcommon.ErrUncertain
			}
			resume, err := plan.ResumeKey()
			if err != nil {
				return zero, localpushcommon.ErrUncertain
			}
			return localpushqueue.Commit{
				OperationID: receipt.OperationID, ResumeKey: resume,
				NodeID: receipt.NodeID, NodeRevision: receipt.NodeRevision,
				ContentSHA: receipt.ContentSHA256, Size: receipt.Size,
			}, nil
		},
		recheckOriginal)
	if runErr != nil {
		return empty, runErr
	}
	latest, err := api.LocalBoundRules(workCtx, sourceID, proof)
	if err != nil || latest.SourceID != sourceID ||
		latest.Revision != source.Revision ||
		latest.IgnoreRules != rules.IgnoreRules ||
		localBackupRuleSessionUnchanged(account) != nil {
		return empty, localpushcommon.ErrUncertain
	}
	// Even when all historical Operations are committed, the CURRENT CAS
	// may have changed. Never assert SourceRun/backup_complete here.
	return localCommonQueueSummary{
		SourceID: sourceID, Revision: source.Revision,
		Candidates: stats.Tasks, Unsupported: unsupported,
		CommittedNow:        stats.CommittedNow,
		HistoricalRechecked: stats.HistoricalRechecked,
		BackupComplete:      false, CurrentCASVerified: false,
		RetirementSafe: false,
	}, nil
}
