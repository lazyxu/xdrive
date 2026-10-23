//go:build linux || windows

package main

import (
	"context"
	"errors"
	"path"
	"strings"

	"github.com/google/uuid"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

var errLocalBackupCommonBatchUnavailable = errors.New("本机多文件备份未确认：请检查原始任务记录、当前云端文件版本及设备授权")

// A scoped, paginated and owner-authenticated read for one immediate child.
// No full 100k-node directory materialization, and no implicit overwrites
// of an existing name with missing trusted Push provenance.
func localCommonRootCurrentChild(ctx context.Context, api *client.Client,
	parentID uint64, name string,
) (*client.Node, error) {
	if ctx == nil || api == nil || parentID == 0 || name == "" {
		return nil, errLocalBackupCommonBatchUnavailable
	}
	var found *client.Node
	cursor := ""
	for pageNumber := 0; pageNumber < 128; pageNumber++ {
		page, err := api.ListPage(ctx, parentID, client.ChildrenOptions{
			Limit: 200, Cursor: cursor, NameCI: name,
		})
		if err != nil {
			return nil, errLocalBackupCommonBatchUnavailable
		}
		for _, item := range page.Items {
			if !strings.EqualFold(item.Name, name) {
				continue
			}
			if found != nil || item.DeletedAt != nil ||
				item.ParentID == nil || *item.ParentID != parentID {
				return nil, errLocalBackupCommonBatchUnavailable
			}
			node := item
			found = &node
		}
		if !page.HasMore && page.NextCursor == "" {
			return found, nil
		}
		if page.NextCursor == "" || page.NextCursor == cursor {
			return nil, errLocalBackupCommonBatchUnavailable
		}
		cursor = page.NextCursor
	}
	return nil, errLocalBackupCommonBatchUnavailable
}

// A full canonical file path may include nested OS directories, but neither
// files nor directory components may escape the approved native Root. File
// uploads still require the original strong, unique native identity and the
// Server's ordinary MaxUploadBytes ceiling.
func validLocalCommonBatchPath(relative string) bool {
	if relative == "" || len(relative) > 4096 ||
		path.Clean(relative) != relative || strings.HasPrefix(relative, "/") ||
		strings.ContainsAny(relative, "\\:\x00\r\n") {
		return false
	}
	for _, segment := range strings.Split(relative, "/") {
		if !localPushFirstLeafNameValid(segment) {
			return false
		}
	}
	return true
}

func eligibleLocalBackupCommonBatchFile(item localpush.InventoryItem) bool {
	return item.Kind == "file" && !item.Ignored &&
		validLocalCommonBatchPath(item.Path) && item.Size >= 0 &&
		item.ModifiedAt != nil && item.NativeIdentity != nil &&
		item.NativeIdentity.Strong && item.NativeIdentity.LinkCount == 1 &&
		item.NativeIdentity.RenameCandidate
}

// runLocalCommonBackupBatchPrivate is the Agent-owned MANUAL folder worker.
// Journaled per-file Operations are the sole durable task queue. The worker
// holds at most the scanned batch and one OS descriptor; it never creates a
// second CAS writer, deletes files, silently retries an uncertain Operation,
// calls the legacy Stage route, or declares SourceRun/backup completion.
// It preserves native folder structure using Source-authorized mkdir and /uploads.
func (c *agentController) runLocalCommonBackupBatchPrivate(
	ctx context.Context, sourceID uint64, onProgress ...func(localBackupCommonBatchSummary),
) (out localBackupCommonBatchSummary, runErr error) {
	publish := func() {
		if len(onProgress) != 0 && onProgress[0] != nil {
			current := out
			current.State, current.Running = "running", true
			onProgress[0](current)
		}
	}
	if c == nil || ctx == nil || ctx.Err() != nil || c.ctx == nil ||
		c.ctx.Err() != nil || sourceID == 0 || !c.localFolderGrantMu.TryLock() {
		return out, errLocalBackupCommonBatchUnavailable
	}
	defer c.localFolderGrantMu.Unlock()
	// A full verified Source can take hours (100k files or very large media).
	// Keep the detached worker bound to the owning Agent lifecycle, not a
	// fixed 30-minute deadline. Individual HTTP operations remain bounded.
	workCtx := ctx
	account, err := userconfig.Load()
	if err != nil || account.SessionInvalid || account.Server == "" ||
		account.Username == "" || account.SessionID == "" {
		return out, errLocalBackupCommonBatchUnavailable
	}
	source, proof, api, err := c.localBoundBackupConfig(workCtx, sourceID)
	if err != nil || api == nil || source.ID != sourceID ||
		source.SyncMode != meta.SourceSyncModeBackup ||
		source.TargetNodeID == nil || *source.TargetNodeID == 0 {
		return out, errLocalBackupCommonBatchUnavailable
	}
	out.SourceID, out.Revision = sourceID, source.Revision
	out.State = "partial"
	publish()
	configDir, err := userconfig.Dir()
	if err != nil {
		return out, errLocalBackupCommonBatchUnavailable
	}
	key, err := currentLocalFirstFileDeviceKey(account, sourceID)
	if err != nil {
		return out, errLocalBackupCommonBatchUnavailable
	}
	legacyPresent, legacyErr := localFirstFileDurableClaimPresent(workCtx, configDir, key)
	if legacyErr != nil || legacyPresent {
		return out, errLocalBackupCommonBatchUnavailable
	}
	grant, err := localpush.LoadRootGrant(configDir, account.Server,
		account.Username, proof.RootID)
	if err != nil || !grant.StrongIdentity || grant.SourceID != sourceID ||
		grant.Server != account.Server || grant.Account != account.Username ||
		grant.DeviceID != proof.DeviceID || grant.RootID != proof.RootID ||
		grant.Fingerprint != proof.RootFingerprint {
		return out, errLocalBackupCommonBatchUnavailable
	}
	if err := localpushstage.RequireFreshLocalOriginalStageScope(workCtx,
		configDir, grant); err != nil {
		return out, errLocalBackupCommonBatchUnavailable
	}
	// Prevent a second Agent instance from running this Source concurrently.
	// A crashed process releases ONLY this kernel lock; immutable original
	// SQL Operations remain and must be reconciled on the next manual run.
	lease, err := localpush.AcquireVerifiedCommonBatchRunLease(workCtx,
		configDir, grant)
	if err != nil {
		return out, errLocalBackupCommonBatchUnavailable
	}
	defer lease.Close()

	// The run summary is NOT a new task queue. Original durable per-file
	// Operations remain the only authority for skipping/retry/commit.
	runID := uuid.NewString()
	saveRun := func(saveCtx context.Context, state string) error {
		checkpoint := localpush.CommonBatchCheckpoint{
			Version: 1, RunID: runID,
			SourceID: sourceID, SourceRevision: source.Revision,
			RootFingerprint: grant.Fingerprint,
			SessionDigest:   localpush.CommonUploadOwnerSessionDigest(account.SessionID),
			State:           state, InspectedFiles: out.InspectedFiles,
			ConfirmedFiles: out.ConfirmedFiles, SkippedFiles: out.SkippedFiles,
			UnsupportedFiles: out.UnsupportedFiles, UncertainFiles: out.UncertainFiles,
			ConfirmedBytes: out.ConfirmedBytes, UpdatedAt: time.Now().UTC(),
			BackupComplete: false, RetirementSafe: false, CurrentCASVerified: false,
		}
		return localpush.StoreVerifiedCommonBatchCheckpoint(
			saveCtx, configDir, grant, account.SessionID, source.Revision, checkpoint)
	}
	if err := saveRun(workCtx, "running"); err != nil {
		return out, errLocalBackupCommonBatchUnavailable
	}
	// Even if the process/IPC disappears after the last remote COMMIT, the
	// last persisted running record becomes UNCERTAIN on fresh Agent read,
	// not a fabricated completed backup.
	defer func() {
		if runErr != nil || out.State != "partial" {
			out.State = "uncertain"
			out.Running = false
			if out.UncertainFiles == 0 {
				out.UncertainFiles = 1
			}
		}
		syncCtx, syncCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer syncCancel()
		if saveErr := saveRun(syncCtx, out.State); saveErr != nil {
			out.State = "uncertain"
			if out.UncertainFiles == 0 {
				out.UncertainFiles = 1
			}
			if runErr == nil {
				runErr = errLocalBackupCommonBatchUnavailable
			}
		}
	}()
	rules, err := api.LocalBoundRules(workCtx, sourceID, proof)
	if err != nil || rules.SourceID != sourceID ||
		rules.Revision != source.Revision {
		return out, errLocalBackupCommonBatchUnavailable
	}
	matcher, err := sourcepkg.CompileIgnoreRules(rules.IgnoreRules)
	if err != nil {
		return out, errLocalBackupCommonBatchUnavailable
	}
	// Each explicit run refreshes CURRENT, otherwise a changed A' would
	// never enter the next incremental generation. A partial/canceled
	// scanner never publishes CURRENT or yields deletion authority.
	snapshot, scanned, err := localpush.ScanInventoryToJournal(workCtx,
		configDir, grant, localpush.InventoryScanner{
			IgnoreRules:           rules.IgnoreRules,
			IncludeNativeIdentity: true,
		})
	if err != nil || !scanned.Complete || scanned.MissingInferenceSafe ||
		snapshot.SnapshotSHA256 == "" {
		return out, errLocalBackupCommonBatchUnavailable
	}
	lastRules := func() error {
		latest, err := api.LocalBoundRules(workCtx, sourceID, proof)
		if err != nil || latest.SourceID != sourceID ||
			latest.Revision != source.Revision ||
			latest.IgnoreRules != rules.IgnoreRules ||
			localBackupRuleSessionUnchanged(account) != nil {
			return errLocalBackupCommonBatchUnavailable
		}
		return nil
	}
	// Directory Node IDs are never trusted as permanent Source identities.
	// Bound memory while batching 100k original files; the Server rechecks
	// every descendant at Admit, Bind and SQL/CAS Finalize.
	directoryCache := make(map[string]uint64)
	// Stream through an independently verified immutable inventory. Never
	// queue all 100k filesystem items in memory or trust renderer file paths.
	after, err := localpush.StreamVerifiedInventoryJournal(workCtx,
		configDir, grant, localpush.DefaultInventoryBatchSize,
		func(items []localpush.InventoryItem) error {
			for _, item := range items {
				if item.Ignored || matcher.Ignored(item.Path, item.Kind == "directory") {
					continue
				}
				// Defer optional empty-directory creation until every
				// historical file has been reconciled. Otherwise moving an
				// old folder outside the Source could cause a new empty
				// folder to be created before the stale file is rejected.
				if item.Kind == "directory" {
					continue
				}
				if item.Kind != "file" {
					continue
				}
				out.InspectedFiles++
				if out.InspectedFiles%16 == 0 {
					publish()
					if err := saveRun(workCtx, "running"); err != nil {
						return errLocalBackupCommonBatchUnavailable
					}
				}
				if !eligibleLocalBackupCommonBatchFile(item) {
					out.UnsupportedFiles++
					continue
				}
				if err := lastRules(); err != nil {
					out.UncertainFiles++
					return err
				}
				digest, err := localpush.HashVerifiedInventoryFile(workCtx, grant, item, nil)
				if err != nil || digest.Path != item.Path ||
					digest.Size != item.Size ||
					digest.NativeIdentityKey != item.NativeIdentity.Key ||
					len(digest.SHA256) != 64 {
					out.UncertainFiles++
					return errLocalBackupCommonBatchUnavailable
				}
				prior, err := localpush.ListVerifiedCommonUploadVersionedPlans(
					configDir, grant, account.SessionID, item.Path)
				if err != nil {
					out.UncertainFiles++
					return errLocalBackupCommonBatchUnavailable
				}
				originals := make([]localCommonVerifiedOriginal, 0, len(prior))
				for _, p := range prior {
					key, keyErr := p.ResumeKey()
					if keyErr != nil {
						out.UncertainFiles++
						return errLocalBackupCommonBatchUnavailable
					}
					receipt, readErr := api.ReadLocalPushCommonUploadReceipt(
						workCtx, sourceID, source.Revision, proof, p.OperationID, key)
					if readErr != nil {
						out.UncertainFiles++
						return errLocalBackupCommonBatchUnavailable
					}
					originals = append(originals, localCommonVerifiedOriginal{Plan: p, Receipt: receipt})
				}
				// Historical file paths are read-only until their prior
				// Operations and current Node identity are reconciled.
				// Only a genuinely new file may create missing directories.
				var parentID uint64
				var filename string
				if len(prior) > 0 {
					parentID, filename, err = localCommonFindExistingCloudParent(
						workCtx, api, sourceID, source.Revision,
						*source.TargetNodeID, proof, item.Path)
				} else {
					parentID, filename, err = localCommonEnsureCloudParent(
						workCtx, api, sourceID, source.Revision,
						*source.TargetNodeID, proof, item.Path, directoryCache)
				}
				if err != nil {
					out.UncertainFiles++
					return errLocalBackupCommonBatchUnavailable
				}
				current, err := localCommonRootCurrentChild(
					workCtx, api, parentID, filename)
				if err != nil {
					out.UncertainFiles++
					return errLocalBackupCommonBatchUnavailable
				}
				target, skipped, err := decideLocalCommonRootFile(
					item.Path, digest.SHA256, digest.Size, sourceID,
					source.Revision, parentID, current, originals)
				if err != nil {
					out.UncertainFiles++
					return errLocalBackupCommonBatchUnavailable
				}
				if skipped {
					// A cached parent Node ID can outlive a directory
					// move. Confirm the exact CURRENT Source-relative
					// folder chain again before counting a file as
					// unchanged, without recreating missing directories.
					if err := localCommonVerifyCloudParent(workCtx, api,
						sourceID, source.Revision, *source.TargetNodeID,
						proof, item.Path, parentID); err != nil {
						out.UncertainFiles++
						return errLocalBackupCommonBatchUnavailable
					}
					// The cloud file itself can be independently replaced,
					// moved, or updated between the first read and skip.
					// Fail closed rather than counting a stale SQL receipt.
					if err := localCommonVerifyCloudFileUnchanged(
						workCtx, api, parentID, current); err != nil {
						out.UncertainFiles++
						return errLocalBackupCommonBatchUnavailable
					}
					out.SkippedFiles++
					publish()
					if out.SkippedFiles%64 == 0 {
						if err := saveRun(workCtx, "running"); err != nil {
							return errLocalBackupCommonBatchUnavailable
						}
					}
					continue
				}
				plan, err := localpush.PrepareVerifiedCommonUploadVersionedPlan(
					workCtx, configDir, grant, account.SessionID, source.Revision,
					snapshot.SnapshotSHA256, item.Path, target)
				if err != nil {
					out.UncertainFiles++
					return errLocalBackupCommonBatchUnavailable
				}
				receipt, err := localpush.UploadVerifiedCommonNativeVersionedOne(
					workCtx, configDir, grant, snapshot.SnapshotSHA256,
					plan, api, proof, nil)
				if err != nil || !localCommonReceiptMatchesPlan(plan, receipt) ||
					lastRules() != nil {
					out.UncertainFiles++
					return errLocalBackupCommonBatchUnavailable
				}
				out.ConfirmedFiles++
				out.ConfirmedBytes += receipt.Size
				publish()
				if err := saveRun(workCtx, "running"); err != nil {
					return errLocalBackupCommonBatchUnavailable
				}
			}
			return workCtx.Err()
		})
	if err != nil || after.SnapshotSHA256 != snapshot.SnapshotSHA256 ||
		after.SnapshotName != snapshot.SnapshotName ||
		workCtx.Err() != nil || localBackupRuleSessionUnchanged(account) != nil {
		out.State = "uncertain"
		return out, errLocalBackupCommonBatchUnavailable
	}
	// A second bounded manifest pass preserves genuinely empty local folders.
	// Do this only after all file operations and original Node checks, so a
	// moved historical subtree fails closed without recreating it first.
	directories, err := localpush.StreamVerifiedInventoryJournal(workCtx,
		configDir, grant, localpush.DefaultInventoryBatchSize,
		func(items []localpush.InventoryItem) error {
			for _, item := range items {
				if item.Kind != "directory" || item.Ignored ||
					matcher.Ignored(item.Path, true) {
					continue
				}
				if !validLocalCommonBatchPath(item.Path) ||
					item.NativeIdentity == nil || !item.NativeIdentity.Strong {
					out.UncertainFiles++
					return errLocalBackupCommonBatchUnavailable
				}
				if err := lastRules(); err != nil {
					out.UncertainFiles++
					return err
				}
				if _, err := localCommonEnsureCloudDirectory(
					workCtx, api, sourceID, source.Revision,
					*source.TargetNodeID, proof, item.Path, directoryCache); err != nil {
					out.UncertainFiles++
					return errLocalBackupCommonBatchUnavailable
				}
			}
			return workCtx.Err()
		})
	if err != nil || directories.SnapshotSHA256 != snapshot.SnapshotSHA256 ||
		directories.SnapshotName != snapshot.SnapshotName ||
		workCtx.Err() != nil || localBackupRuleSessionUnchanged(account) != nil {
		out.State = "uncertain"
		return out, errLocalBackupCommonBatchUnavailable
	}
	// Per-file immutable COMMIT and current descendant checks do not yet
	// grant a whole-SourceRun or current physical CAS completion proof.
	out.State = "partial"
	return out, nil
}

// A worker error takes precedence over an earlier partial in-memory
// snapshot. An IPC observer must NEVER see "partial / no uncertainty" after
// the Agent stopped on an unverified source, SQL receipt or local file.
func localCommonBatchObservedResult(job *localPushCommonBatchJob) localBackupCommonBatchSummary {
	if job == nil {
		return localBackupCommonBatchSummary{State: "uncertain", UncertainFiles: 1}
	}
	out := job.result
	if job.err != nil {
		out.State = "uncertain"
		out.Running = false
		if out.UncertainFiles == 0 {
			out.UncertainFiles = 1
		}
	}
	return out
}

// A detached, single owning-Agent job survives Desktop observer disconnects.
// A new explicit invocation starts a fresh incremental scan after completion.
// beginLocalCommonBatchJob only admits or joins a detached Agent worker.
// The Desktop request lifetime is an observer, never the transfer deadline.
func (c *agentController) beginLocalCommonBatchJob(
	ctx context.Context, sourceID uint64,
) (*localPushCommonBatchJob, error) {
	if c == nil || ctx == nil || ctx.Err() != nil || c.ctx == nil ||
		c.ctx.Err() != nil || sourceID == 0 {
		return nil, errLocalBackupCommonBatchUnavailable
	}
	account, err := userconfig.Load()
	if err != nil || account.SessionInvalid || account.Server == "" ||
		account.Username == "" || account.SessionID == "" {
		return nil, errLocalBackupCommonBatchUnavailable
	}
	key, err := currentLocalFirstFileDeviceKey(account, sourceID)
	if err != nil || !key.valid() {
		return nil, errLocalBackupCommonBatchUnavailable
	}
	// The immediate 202 ACK must be scoped to a CURRENT owning Backup Source,
	// not merely an arbitrary numeric Source ID submitted by the Renderer.
	// The worker repeats all checks immediately before filesystem/SQL work.
	source, _, api, scopeErr := c.localBoundBackupConfig(ctx, sourceID)
	if scopeErr != nil || api == nil || source.ID != sourceID ||
		source.SyncMode != meta.SourceSyncModeBackup ||
		source.TargetNodeID == nil || *source.TargetNodeID == 0 {
		return nil, errLocalBackupCommonBatchUnavailable
	}
	c.localCommonBatchJobMu.Lock()
	defer c.localCommonBatchJobMu.Unlock()
	job := c.localCommonBatchJob
	if job != nil {
		select {
		case <-job.done:
			job = nil
		default:
			if job.key != key {
				return nil, errLocalBackupCommonBatchUnavailable
			}
		}
	}
	if job == nil {
		job = &localPushCommonBatchJob{
			key: key, done: make(chan struct{}),
			progress: localBackupCommonBatchSummary{
				SourceID: sourceID, State: "running", Running: true,
			},
		}
		c.localCommonBatchJob = job
		go func() {
			job.result, job.err = c.runLocalCommonBackupBatchPrivate(
				c.ctx, key.sourceID, job.setProgress)
			close(job.done)
		}()
	}
	return job, nil
}

// CloudStartLocalBoundBackupCommonBatch returns as soon as the owning Agent
// accepts the job. The worker survives HTTP/Electron observer disconnects.
// The subsequent status read is a projection, never a second task queue or
// a physical cancel/backup_complete receipt.
func (c *agentController) CloudStartLocalBoundBackupCommonBatch(
	ctx context.Context, sourceID uint64,
) (localBackupCommonBatchSummary, error) {
	job, err := c.beginLocalCommonBatchJob(ctx, sourceID)
	if err != nil {
		return localBackupCommonBatchSummary{}, err
	}
	select {
	case <-job.done:
		return localCommonBatchObservedResult(job), job.err
	default:
		return job.currentProgress(), nil
	}
}

// Keep the direct waiting API for native callers and tests. The Desktop POST
// uses CloudStartLocalBoundBackupCommonBatch and must never wait for 100k files.
func (c *agentController) CloudRunLocalBoundBackupCommonBatch(
	ctx context.Context, sourceID uint64,
) (localBackupCommonBatchSummary, error) {
	job, err := c.beginLocalCommonBatchJob(ctx, sourceID)
	if err != nil {
		return localBackupCommonBatchSummary{}, err
	}
	select {
	case <-ctx.Done():
		return localBackupCommonBatchSummary{}, ctx.Err()
	case <-job.done:
		current, loadErr := userconfig.Load()
		if loadErr != nil {
			return localBackupCommonBatchSummary{}, errLocalBackupCommonBatchUnavailable
		}
		currentKey, keyErr := currentLocalFirstFileDeviceKey(current, sourceID)
		if keyErr != nil || currentKey != job.key || ctx.Err() != nil {
			return localBackupCommonBatchSummary{}, errLocalBackupCommonBatchUnavailable
		}
		return job.result, job.err
	}
}

func (c *agentController) CloudLocalBoundBackupCommonBatchStatus(
	ctx context.Context, sourceID uint64,
) (localBackupCommonBatchSummary, error) {
	var empty localBackupCommonBatchSummary
	if c == nil || ctx == nil || ctx.Err() != nil || sourceID == 0 {
		return empty, errLocalBackupCommonBatchUnavailable
	}
	account, err := userconfig.Load()
	if err != nil || account.SessionInvalid {
		return empty, errLocalBackupCommonBatchUnavailable
	}
	key, err := currentLocalFirstFileDeviceKey(account, sourceID)
	if err != nil || !key.valid() {
		return empty, errLocalBackupCommonBatchUnavailable
	}
	c.localCommonBatchJobMu.Lock()
	job := c.localCommonBatchJob
	c.localCommonBatchJobMu.Unlock()
	if job == nil || job.key != key {
		// After Agent restart, the in-memory job disappears. Read ONLY the
		// locally persisted, Owner/Device/Root/Source-verified summary.
		// No credentials or file names cross the Renderer boundary.
		source, proof, _, scopeErr := c.localBoundBackupConfig(ctx, sourceID)
		if scopeErr != nil || source.ID != sourceID || source.Revision == 0 {
			return empty, errLocalBackupCommonBatchUnavailable
		}
		configDir, dirErr := userconfig.Dir()
		if dirErr != nil {
			return empty, errLocalBackupCommonBatchUnavailable
		}
		grant, rootErr := localpush.LoadRootGrant(
			configDir, account.Server, account.Username, proof.RootID)
		if rootErr != nil || !grant.StrongIdentity || grant.SourceID != sourceID ||
			grant.DeviceID != proof.DeviceID ||
			grant.Fingerprint != proof.RootFingerprint {
			return empty, errLocalBackupCommonBatchUnavailable
		}
		cp, readErr := localpush.ReadVerifiedCommonBatchCheckpoint(
			ctx, configDir, grant, account.SessionID, source.Revision)
		if readErr != nil {
			return empty, errLocalBackupCommonBatchUnavailable
		}
		result := localBackupCommonBatchSummary{
			SourceID: sourceID, Revision: source.Revision,
			State: cp.State, InspectedFiles: cp.InspectedFiles,
			ConfirmedFiles: cp.ConfirmedFiles, SkippedFiles: cp.SkippedFiles,
			UnsupportedFiles: cp.UnsupportedFiles, UncertainFiles: cp.UncertainFiles,
			ConfirmedBytes: cp.ConfirmedBytes,
		}
		if result.State == "running" {
			result.State = "uncertain"
			result.UncertainFiles++
		}
		return result, nil
	}
	select {
	case <-job.done:
		return localCommonBatchObservedResult(job), nil
	default:
		return job.currentProgress(), nil
	}
}
