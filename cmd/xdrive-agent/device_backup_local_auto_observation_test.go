//go:build linux || windows

package main

import (
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
)

func localAutoObservationFixture() (
	client.Source, client.LocalBoundBackupSchedule,
	localpush.CommonBatchCheckpoint, time.Time,
) {
	start := time.Date(2026, 11, 4, 0, 0, 0, 0, time.UTC)
	target := uint64(10)
	source := client.Source{
		ID: 42, Revision: 7, Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		TargetNodeID: &target,
	}
	plan := client.LocalBoundBackupSchedule{
		SourceID: 42, Revision: 7, ScheduleType: "interval",
		ScheduleExpression: "6h",
	}
	checkpoint := localpush.CommonBatchCheckpoint{
		SourceID: 42, SourceRevision: 7,
		State: "partial", UpdatedAt: start,
		InspectedFiles: 1, ConfirmedFiles: 1,
	}
	return source, plan, checkpoint, start
}

func TestLocalAutoReadinessUsesOnlyVerifiedCurrentCheckpointAndRealDueRule(t *testing.T) {
	source, plan, checkpoint, last := localAutoObservationFixture()
	now := last.Add(2 * time.Hour)
	observed := projectLocalBoundAutoReadiness(source, plan, &checkpoint, now)
	if observed.AutoReadiness != "checkpoint_ready" ||
		observed.NextScheduledAt == nil ||
		!observed.NextScheduledAt.Equal(last.Add(6*time.Hour)) {
		t.Fatalf("wrong verified next schedule observation: %+v", observed)
	}
	for _, at := range []time.Time{last.Add(2 * time.Hour), last.Add(6 * time.Hour)} {
		due, err := localPushAutomaticDue(plan, checkpoint, at)
		if err != nil || due != !observed.NextScheduledAt.After(at) {
			t.Fatalf("UI checkpoint observation diverged from real scheduler: due=%t err=%v", due, err)
		}
	}
	if checkpoint.State != "partial" || !checkpoint.UpdatedAt.Equal(last) {
		t.Fatal("read-only observation modified the original checkpoint")
	}
	observed = projectLocalBoundAutoReadiness(source, plan, nil, now)
	if observed.AutoReadiness != "checkpoint_unverified" || observed.NextScheduledAt != nil {
		t.Fatalf("missing current trusted private checkpoint incorrectly armed auto: %+v", observed)
	}
}

func TestLocalAutoReadinessRejectsUncertainStoppedOrWrongRevision(t *testing.T) {
	source, plan, checkpoint, last := localAutoObservationFixture()
	now := last.Add(48 * time.Hour)
	for _, state := range []string{"running", "paused", "cancelled", "uncertain"} {
		t.Run(state, func(t *testing.T) {
			unverified := checkpoint
			unverified.State = state
			got := projectLocalBoundAutoReadiness(source, plan, &unverified, now)
			expected := "review_required"
			if state == "running" {
				expected = "reconciliation_pending"
			}
			if got.AutoReadiness != expected || got.NextScheduledAt != nil {
				t.Fatalf("unexpected %s recovery readiness: %+v", state, got)
			}
		})
	}
	pending := checkpoint
	pending.State, pending.UncertainFiles = "uncertain", 1
	if got := projectLocalBoundAutoReadiness(source, plan, &pending, now); got.AutoReadiness != "reconciliation_pending" {
		t.Fatalf("uncertain original did not expose safe readback pending state: %+v", got)
	}
	revisedPlan := plan
	revisedPlan.Revision++
	revisedSource := source
	revisedSource.Revision++
	if got := projectLocalBoundAutoReadiness(revisedSource, revisedPlan, &checkpoint, now); got.AutoReadiness != "revision_rebaseline_pending" {
		t.Fatalf("same-owner schedule revision did not require new baseline: %+v", got)
	}
	unknownReceipt := checkpoint
	unknownReceipt.UncertainFiles = 1
	if got := projectLocalBoundAutoReadiness(source, plan, &unknownReceipt, now); got.AutoReadiness != "review_required" {
		t.Fatalf("unknown SQL receipt was treated as ready: %+v", got)
	}
	for _, mutate := range []func(*localpush.CommonBatchCheckpoint){
		func(cp *localpush.CommonBatchCheckpoint) { cp.SourceID++ },
		func(cp *localpush.CommonBatchCheckpoint) { cp.SourceRevision++ },
		func(cp *localpush.CommonBatchCheckpoint) { cp.UpdatedAt = time.Time{} },
		func(cp *localpush.CommonBatchCheckpoint) { cp.BackupComplete = true },
		func(cp *localpush.CommonBatchCheckpoint) { cp.RetirementSafe = true },
		func(cp *localpush.CommonBatchCheckpoint) { cp.CurrentCASVerified = true },
	} {
		bad := checkpoint
		mutate(&bad)
		got := projectLocalBoundAutoReadiness(source, plan, &bad, now)
		if got.AutoReadiness != "checkpoint_unverified" || got.NextScheduledAt != nil {
			t.Fatalf("wrong identity / forged CAS completion was trusted: %+v", got)
		}
	}
	changed := source
	changed.Revision++
	got := projectLocalBoundAutoReadiness(changed, plan, &checkpoint, now)
	if got.AutoReadiness != "unavailable" || got.NextScheduledAt != nil {
		t.Fatalf("Source revision change reused old auto status: %+v", got)
	}
}

func TestLocalAutoReadinessDoesNotArmManualUnconfiguredOrMirror(t *testing.T) {
	source, plan, checkpoint, last := localAutoObservationFixture()
	now := last.Add(24 * time.Hour)
	manual := plan
	manual.ScheduleType, manual.ScheduleExpression = "manual", ""
	got := projectLocalBoundAutoReadiness(source, manual, &checkpoint, now)
	if got.AutoReadiness != "manual" || got.NextScheduledAt != nil {
		t.Fatalf("manual plan accidentally admitted: %+v", got)
	}
	empty := plan
	empty.ScheduleType, empty.ScheduleExpression = "", ""
	got = projectLocalBoundAutoReadiness(source, empty, &checkpoint, now)
	if got.AutoReadiness != "not_enabled" || got.NextScheduledAt != nil {
		t.Fatalf("unconfigured plan accidentally admitted: %+v", got)
	}
	mirror := source
	mirror.SyncMode = meta.SourceSyncModeMirror
	got = projectLocalBoundAutoReadiness(mirror, plan, &checkpoint, now)
	if got.AutoReadiness != "ineligible_source" || got.NextScheduledAt != nil {
		t.Fatalf("Mirror plan armed forbidden Backup-only writer: %+v", got)
	}
	unbound := source
	unbound.TargetNodeID = nil
	got = projectLocalBoundAutoReadiness(unbound, plan, &checkpoint, now)
	if got.AutoReadiness != "ineligible_source" || got.NextScheduledAt != nil {
		t.Fatalf("unbound root plan appeared auto-ready: %+v", got)
	}
	badSpec := plan
	badSpec.ScheduleExpression = "not-an-interval"
	got = projectLocalBoundAutoReadiness(source, badSpec, &checkpoint, now)
	if got.AutoReadiness != "unavailable" || got.NextScheduledAt != nil {
		t.Fatalf("invalid schedule invented a due time: %+v", got)
	}
}

func TestLocalAutoReadinessCronUsesAgentTimezoneAndCheckpoint(t *testing.T) {
	source, plan, cp, _ := localAutoObservationFixture()
	plan.ScheduleType = "cron"
	plan.ScheduleExpression = "0 9 * * *"
	plan.ScheduleTimezone = "Asia/Tokyo"
	cp.UpdatedAt = time.Date(2026, 10, 20, 0, 1, 0, 0, time.UTC)
	got := projectLocalBoundAutoReadiness(source, plan, &cp,
		time.Date(2026, 10, 20, 23, 0, 0, 0, time.UTC))
	want := time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC)
	if got.AutoReadiness != "checkpoint_ready" ||
		got.NextScheduledAt == nil || !got.NextScheduledAt.Equal(want) {
		t.Fatalf("wrong Zone/IANA due rule: got=%+v want=%s", got, want)
	}
}
