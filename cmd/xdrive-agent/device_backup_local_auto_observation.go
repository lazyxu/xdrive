//go:build linux || windows

package main

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// projectLocalBoundAutoReadiness is a read-only view of the scheduler's
// existing eligibility inputs. A *saved* schedule alone cannot authorize work.
// The private checkpoint is checked independently by the real auto scheduler
// before any admission; this DTO cannot override its durable cooldown, other
// Source leases, discovery backoff, current Owner or live server availability.
//
// NextScheduledAt is the *rule due time*, NOT a promised execution, wake-up,
// physical upload or complete Source/CAS proof.
func projectLocalBoundAutoReadiness(
	source client.Source, saved client.LocalBoundBackupSchedule,
	checkpoint *localpush.CommonBatchCheckpoint, now time.Time,
) client.LocalBoundBackupSchedule {
	saved.AutoReadiness = "unavailable"
	saved.NextScheduledAt = nil
	if source.ID == 0 || source.Revision == 0 ||
		saved.SourceID != source.ID || saved.Revision != source.Revision || now.IsZero() {
		return saved
	}
	spec, err := sourceschedule.Normalize(
		saved.ScheduleType, saved.ScheduleExpression, saved.ScheduleTimezone)
	if err != nil {
		return saved
	}
	switch spec.Type {
	case "":
		saved.AutoReadiness = "not_enabled"
		return saved
	case sourceschedule.TypeManual:
		saved.AutoReadiness = "manual"
		return saved
	}
	if source.SyncMode != meta.SourceSyncModeBackup ||
		source.TargetNodeID == nil || *source.TargetNodeID == 0 {
		saved.AutoReadiness = "ineligible_source"
		return saved
	}
	if checkpoint == nil || checkpoint.SourceID != saved.SourceID ||
		checkpoint.SourceRevision != saved.Revision || checkpoint.UpdatedAt.IsZero() ||
		checkpoint.BackupComplete || checkpoint.RetirementSafe || checkpoint.CurrentCASVerified {
		saved.AutoReadiness = "checkpoint_unverified"
		return saved
	}
	if !localpush.CommonCheckpointAutoAdmissible(*checkpoint) {
		saved.AutoReadiness = "review_required"
		return saved
	}
	if checkpoint.State == "running" || checkpoint.State == "uncertain" {
		saved.AutoReadiness = "reconciliation_pending"
		return saved // not a successful schedule run or CAS proof
	}
	last := checkpoint.UpdatedAt.UTC()
	// Mirror precisely the due-rule calculation in localPushAutomaticDue.
	// The original scheduler will still revalidate this private checkpoint,
	// session, device, Root and cooldown at the real timer wake.
	rule := meta.Source{
		ScheduleType: spec.Type, ScheduleExpression: spec.Expression,
		ScheduleTimezone: spec.Timezone, LastRunAt: &last,
	}
	next, err := sourceschedule.NextRunAt(rule, now.UTC(), 0)
	if err != nil || next.IsZero() {
		return saved
	}
	next = next.UTC()
	saved.AutoReadiness = "checkpoint_ready"
	saved.NextScheduledAt = &next
	return saved
}

// localBoundAgentAutoReadiness reads private filesystem state only AFTER
// current Source/Owner/Device/Root validation by localBoundBackupConfig.
// It never stores, reserves or changes an upload Operation/admission record.
func localBoundAgentAutoReadiness(
	ctx context.Context, cfg userconfig.Config, source client.Source,
	proof client.LocalBoundSourceProof, saved client.LocalBoundBackupSchedule,
) client.LocalBoundBackupSchedule {
	if ctx == nil || ctx.Err() != nil {
		saved.AutoReadiness = "unavailable"
		saved.NextScheduledAt = nil
		return saved
	}
	// No private read is needed for disabled/manual plans.
	if saved.ScheduleType == "" || saved.ScheduleType == sourceschedule.TypeManual {
		return projectLocalBoundAutoReadiness(source, saved, nil, time.Now().UTC())
	}
	// An unsupported/mirror or unbound Source cannot be armed.
	if source.SyncMode != meta.SourceSyncModeBackup ||
		source.TargetNodeID == nil || *source.TargetNodeID == 0 {
		return projectLocalBoundAutoReadiness(source, saved, nil, time.Now().UTC())
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return projectLocalBoundAutoReadiness(source, saved, nil, time.Now().UTC())
	}
	grant, err := localpush.LoadRootGrant(configDir, cfg.Server, cfg.Username, proof.RootID)
	if err != nil || !grant.StrongIdentity || grant.SourceID != source.ID ||
		grant.DeviceID != proof.DeviceID || grant.Fingerprint != proof.RootFingerprint {
		saved.AutoReadiness = "unavailable"
		saved.NextScheduledAt = nil
		return saved
	}
	checkpoint, err := localpush.ReadVerifiedCommonBatchCheckpoint(
		ctx, configDir, grant, cfg.SessionID, source.Revision)
	if err != nil {
		return projectLocalBoundAutoReadiness(source, saved, nil, time.Now().UTC())
	}
	return projectLocalBoundAutoReadiness(source, saved, &checkpoint, time.Now().UTC())
}
