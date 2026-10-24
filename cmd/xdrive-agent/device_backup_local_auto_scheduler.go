//go:build linux || windows

package main

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

const (
	localPushAutoInterval         = time.Minute
	localPushAutoTickTimeout      = 50 * time.Second
	localPushAutoAttemptCooldown  = 15 * time.Minute
	localPushAutoMaxPages         = 64
	localPushAutoPageSize         = 100
	localPushAutoMaxAttemptMemory = 2048
)

var errLocalPushAutoUnavailable = errors.New("local Push automatic scheduling unavailable")

// These are authenticated Owner-readable *identifiers* only. They are NOT
// local Root grants and never confer native filesystem access or upload rights.
func localPushAutoOwnedFolderIDs(ctx context.Context, api *client.Client, deviceID string) ([]uint64, error) {
	if ctx == nil || ctx.Err() != nil || api == nil || deviceID == "" {
		return nil, errLocalPushAutoUnavailable
	}
	out := make([]uint64, 0, localPushAutoPageSize)
	var after uint64
	for pageIndex := 0; pageIndex < localPushAutoMaxPages; pageIndex++ {
		page, err := api.DeviceBackupFoldersPage(ctx, deviceID, localPushAutoPageSize, after)
		if err != nil || len(page.Folders) > localPushAutoPageSize {
			return nil, errLocalPushAutoUnavailable
		}
		last := after
		for _, folder := range page.Folders {
			if folder.SourceID <= last ||
				(folder.SyncMode != meta.SourceSyncModeBackup &&
					folder.SyncMode != meta.SourceSyncModeMirror) {
				return nil, errLocalPushAutoUnavailable
			}
			last = folder.SourceID
			if folder.SyncMode == meta.SourceSyncModeBackup {
				out = append(out, folder.SourceID)
			}
		}
		if !page.HasMore {
			if page.NextAfterSourceID != 0 {
				return nil, errLocalPushAutoUnavailable
			}
			return out, nil
		}
		if len(page.Folders) == 0 || page.NextAfterSourceID != last {
			return nil, errLocalPushAutoUnavailable
		}
		after = last
	}
	return nil, errLocalPushAutoUnavailable // incomplete enumeration cannot trigger work
}

// Only an explicitly configured schedule and a VERIFIED previous own-Agent
// partial run arm automation. "partial" describes per-file receipts, not a
// trusted complete Source or present-day physical CAS verification.
// Unknown/crashed/paused/cancelled runs require deliberate owning-Desktop
// reconciliation first; do not automatically retry uncertain SQL operations.
func localPushAutomaticDue(
	saved client.LocalBoundBackupSchedule,
	checkpoint localpush.CommonBatchCheckpoint,
	now time.Time,
) (bool, error) {
	if now.IsZero() || saved.SourceID == 0 || saved.Revision == 0 ||
		checkpoint.SourceID != saved.SourceID ||
		checkpoint.SourceRevision != saved.Revision ||
		checkpoint.UpdatedAt.IsZero() ||
		checkpoint.BackupComplete || checkpoint.RetirementSafe ||
		checkpoint.CurrentCASVerified {
		return false, errLocalPushAutoUnavailable
	}
	if checkpoint.State != "partial" || checkpoint.UncertainFiles != 0 {
		return false, nil
	}
	spec, err := sourceschedule.Normalize(saved.ScheduleType,
		saved.ScheduleExpression, saved.ScheduleTimezone)
	if err != nil {
		return false, err
	}
	if spec.Type == "" || spec.Type == sourceschedule.TypeManual {
		return false, nil
	}
	last := checkpoint.UpdatedAt.UTC()
	source := meta.Source{
		ScheduleType: spec.Type, ScheduleExpression: spec.Expression,
		ScheduleTimezone: spec.Timezone, LastRunAt: &last,
	}
	next, err := sourceschedule.NextRunAt(source, now.UTC(), 0)
	if err != nil {
		return false, err
	}
	return !next.After(now.UTC()), nil
}

// Throttle an admission that left the SAME trusted checkpoint unchanged.
// A new completed, verified partial attempt refreshes UpdatedAt and must not
// be delayed by the old 15-minute failure guard (e.g. an explicit 1m policy).
func localPushAutoAdmissionCoolingDown(lastAttempt, checkpointUpdatedAt, now time.Time) bool {
	return !lastAttempt.IsZero() &&
		now.Before(lastAttempt.Add(localPushAutoAttemptCooldown)) &&
		!checkpointUpdatedAt.After(lastAttempt)
}

// localPushAutoFairOrder gives the Source least recently considered by
// THIS owning Agent the first chance on the next tick. Without this rotation,
// a healthy one-minute Source can starve every higher-ID Source forever.
// Attempt timestamps are advisory fairness only: they do not confer Root or
// Server authority and cannot override the durable admission cooldown.
func localPushAutoFairOrder(
	ids []uint64, attempts map[string]time.Time, server, account string,
) []uint64 {
	if len(ids) < 2 {
		return ids
	}
	last := make(map[uint64]time.Time)
	prefix := server + "\x00" + account + "\x00"
	for key, timestamp := range attempts {
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		rawSource, rawRevision, ok := strings.Cut(strings.TrimPrefix(key, prefix), "\x00")
		if !ok || rawRevision == "" || strings.Contains(rawRevision, "\x00") {
			continue
		}
		id, sourceErr := strconv.ParseUint(rawSource, 10, 64)
		revision, revisionErr := strconv.ParseUint(rawRevision, 10, 64)
		if sourceErr != nil || revisionErr != nil || id == 0 || revision == 0 {
			continue
		}
		if old, ok := last[id]; !ok || timestamp.After(old) {
			last[id] = timestamp
		}
	}
	out := append([]uint64(nil), ids...)
	sort.Slice(out, func(i, j int) bool {
		left, right := last[out[i]], last[out[j]]
		if !left.Equal(right) {
			return left.Before(right)
		}
		return out[i] < out[j]
	})
	return out
}

func (c *agentController) runLocalPushAutoScheduler() {
	if c == nil || c.ctx == nil {
		return
	}
	ticker := time.NewTicker(localPushAutoInterval)
	defer ticker.Stop()
	attempts := make(map[string]time.Time)
	for {
		select {
		case <-c.ctx.Done():
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(c.ctx, localPushAutoTickTimeout)
			_ = c.localPushAutoTick(ctx, time.Now().UTC(), attempts)
			cancel()
		}
	}
}

// A single owner-scoped Agent ticker discovers only its own device's Source
// IDs, checks the private bound Device/Root/Source, then runs the SAME manual
// durable queue through CloudStartLocalBoundBackupCommonBatch.
// No server-side local filesystem access, mirror delete, or second CAS writer.
func (c *agentController) localPushAutoTick(
	ctx context.Context, now time.Time, attempts map[string]time.Time,
) error {
	if c == nil || ctx == nil || ctx.Err() != nil || attempts == nil {
		return errLocalPushAutoUnavailable
	}
	api, account, err := c.cloudClient()
	if err != nil || api == nil {
		return errLocalPushAutoUnavailable
	}
	if account.SessionInvalid || account.Server == "" ||
		account.Username == "" || account.SessionID == "" {
		return nil
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return err
	}
	deviceID, err := localpush.LoadDeviceRegistration(configDir,
		account.Server, account.Username)
	if err != nil {
		return nil // unregistered device never auto-enrolls
	}
	ids, err := localPushAutoOwnedFolderIDs(ctx, api, deviceID)
	if err != nil {
		return err
	}

	// At most one scheduling admission per tick and one in-flight Source
	// globally. An active manual run ALWAYS takes precedence.
	c.localCommonBatchJobMu.Lock()
	job := c.localCommonBatchJob
	busy := false
	if job != nil {
		select {
		case <-job.done:
		default:
			busy = true
		}
	}
	c.localCommonBatchJobMu.Unlock()
	if busy {
		return nil
	}
	for _, sourceID := range localPushAutoFairOrder(ids, attempts, account.Server, account.Username) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		source, proof, scopedAPI, err := c.localBoundBackupConfig(ctx, sourceID)
		if err != nil || scopedAPI == nil ||
			source.ID != sourceID || source.Revision == 0 ||
			source.SyncMode != meta.SourceSyncModeBackup ||
			source.TargetNodeID == nil || *source.TargetNodeID == 0 {
			continue
		}
		saved, err := scopedAPI.LocalBoundSchedule(ctx, sourceID, proof)
		if err != nil || saved.SourceID != sourceID ||
			saved.Revision != source.Revision {
			continue
		}
		grant, err := localpush.LoadRootGrant(configDir, account.Server,
			account.Username, proof.RootID)
		if err != nil || grant.SourceID != sourceID ||
			grant.DeviceID != proof.DeviceID ||
			grant.Fingerprint != proof.RootFingerprint {
			continue
		}
		checkpoint, err := localpush.ReadVerifiedCommonBatchCheckpoint(
			ctx, configDir, grant, account.SessionID, source.Revision)
		if err != nil {
			continue // no matching prior manual run, rotated session or corrupt journal
		}
		due, err := localPushAutomaticDue(saved, checkpoint, now)
		if err != nil || !due {
			continue
		}
		key := account.Server + "\x00" + account.Username + "\x00" +
			strconv.FormatUint(sourceID, 10) + "\x00" +
			strconv.FormatUint(source.Revision, 10)
		if last, ok := attempts[key]; ok &&
			localPushAutoAdmissionCoolingDown(last, checkpoint.UpdatedAt, now) {
			continue
		}
		if err := localBackupRuleSessionUnchanged(account); err != nil {
			return err
		}
		if len(attempts) >= localPushAutoMaxAttemptMemory {
			for priorKey, last := range attempts {
				if now.Sub(last) >= localPushAutoAttemptCooldown {
					delete(attempts, priorKey)
				}
			}
			if len(attempts) >= localPushAutoMaxAttemptMemory {
				return errLocalPushAutoUnavailable
			}
		}
		// Preserve the admission cooldown across Agent restarts. This is
		// advisory scheduling state, not a separate durable work queue:
		// the worker's Source lease and original SQL Operation remain sole
		// write authority. Missing/corrupt/private journal fails closed.
		admitted, throttleErr := localpush.ReserveVerifiedCommonAutoAdmission(
			ctx, configDir, grant, account.SessionID, checkpoint, now)
		if throttleErr != nil || !admitted {
			continue
		}
		attempts[key] = now
		// This may fail if another owning Desktop starts manually; the
		// existing one-Source worker/lease fails closed, without requeueing.
		_, _ = c.CloudStartLocalBoundBackupCommonBatch(ctx, sourceID)
		return nil
	}
	return nil
}
