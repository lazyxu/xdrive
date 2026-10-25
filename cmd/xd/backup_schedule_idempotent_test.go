package main

import (
	"context"
	"errors"
	"testing"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
)

// The fake only records the existing private Agent reads/writes. There is
// no second scheduler or uploader on the xd side.
type recordingBackupScheduleAgent struct {
	current    localbackupipc.Schedule
	readErr    error
	writeErr   error
	reads      int
	writes     int
	lastSource uint64
	lastRev    uint64
}

func (a *recordingBackupScheduleAgent) ReadSchedule(context.Context, uint64) (localbackupipc.Schedule, error) {
	a.reads++
	if a.readErr != nil {
		return localbackupipc.Schedule{}, a.readErr
	}
	return a.current, nil
}

func (a *recordingBackupScheduleAgent) SaveSchedule(
	_ context.Context, id, rev uint64, spec localbackupipc.Schedule,
) (localbackupipc.Schedule, error) {
	a.writes++
	a.lastSource, a.lastRev = id, rev
	if a.writeErr != nil {
		return localbackupipc.Schedule{}, a.writeErr
	}
	if id != a.current.SourceID || rev != a.current.Revision {
		return localbackupipc.Schedule{}, errors.New("stale Source revision")
	}
	spec.Revision = rev + 1
	a.current = spec
	return spec, nil
}

func TestBackupAutoRepeatedIdenticalScheduleIsReadOnly(t *testing.T) {
	for _, tc := range []struct {
		name     string
		schedule localbackupipc.Schedule
		desired  sourceschedule.Spec
	}{
		{"manual", localbackupipc.Schedule{
			SourceID: 42, Revision: 7, ScheduleType: "manual",
		}, sourceschedule.Spec{Type: "manual"}},
		{"interval", localbackupipc.Schedule{
			SourceID: 42, Revision: 7, ScheduleType: "interval", ScheduleExpression: "6h",
		}, sourceschedule.Spec{Type: "interval", Expression: "6h"}},
		{"cron", localbackupipc.Schedule{
			SourceID: 42, Revision: 7, ScheduleType: "cron",
			ScheduleExpression: "0 2 * * *", ScheduleTimezone: "Asia/Tokyo",
		}, sourceschedule.Spec{Type: "cron", Expression: "0 2 * * *", Timezone: "Asia/Tokyo"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			agent := &recordingBackupScheduleAgent{
				current: tc.schedule,
				// Production Agent rejects the redundant PATCH; the CLI must not call it.
				writeErr: errors.New("saved schedule has not changed"),
			}
			got, changed, err := saveBackupScheduleIfChanged(
				context.Background(), agent, 42, tc.desired)
			if err != nil || changed || got != tc.schedule ||
				agent.reads != 1 || agent.writes != 0 {
				t.Fatalf("identical schedule invalidated original Source revision: got=%+v changed=%t agent=%+v err=%v",
					got, changed, agent, err)
			}
		})
	}
}

func TestBackupAutoChangedScheduleWritesOnceAndThenBecomesNoop(t *testing.T) {
	agent := &recordingBackupScheduleAgent{current: localbackupipc.Schedule{
		SourceID: 42, Revision: 9, ScheduleType: "manual",
	}}
	desired := sourceschedule.Spec{Type: "interval", Expression: "6h"}
	first, changed, err := saveBackupScheduleIfChanged(context.Background(), agent, 42, desired)
	if err != nil || !changed || first.Revision != 10 ||
		agent.writes != 1 || agent.lastRev != 9 || agent.lastSource != 42 {
		t.Fatalf("changed policy did not write exactly once: got=%+v changed=%t agent=%+v err=%v",
			first, changed, agent, err)
	}
	second, changed, err := saveBackupScheduleIfChanged(context.Background(), agent, 42, desired)
	if err != nil || changed || second != first || agent.writes != 1 {
		t.Fatalf("second identical invocation rearmed the policy: got=%+v changed=%t agent=%+v err=%v",
			second, changed, agent, err)
	}
}

func TestBackupAutoInvalidOrUnverifiedScheduleNeverWrites(t *testing.T) {
	valid := sourceschedule.Spec{Type: "interval", Expression: "6h"}
	for _, tc := range []struct {
		name    string
		current localbackupipc.Schedule
		desired sourceschedule.Spec
		readErr error
	}{
		{"invalid_source", localbackupipc.Schedule{SourceID: 7, Revision: 9, ScheduleType: "manual"}, valid, nil},
		{"zero_revision", localbackupipc.Schedule{SourceID: 42, ScheduleType: "manual"}, valid, nil},
		{"bad_desired", localbackupipc.Schedule{SourceID: 42, Revision: 9, ScheduleType: "manual"},
			sourceschedule.Spec{Type: "manual", Expression: "surprise"}, nil},
		{"read_failure", localbackupipc.Schedule{SourceID: 42, Revision: 9, ScheduleType: "manual"},
			valid, errors.New("Agent offline")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			agent := &recordingBackupScheduleAgent{current: tc.current, readErr: tc.readErr}
			if _, changed, err := saveBackupScheduleIfChanged(
				context.Background(), agent, 42, tc.desired); err == nil || changed || agent.writes != 0 {
				t.Fatalf("unsafe schedule updated: changed=%t agent=%+v err=%v", changed, agent, err)
			}
		})
	}
	agent := &recordingBackupScheduleAgent{current: localbackupipc.Schedule{
		SourceID: 42, Revision: 9, ScheduleType: "manual",
	}, writeErr: errors.New("concurrent Source edit")}
	if _, changed, err := saveBackupScheduleIfChanged(
		context.Background(), agent, 42, valid); err == nil || changed || agent.writes != 1 {
		t.Fatalf("schedule write error incorrectly claimed success: changed=%t agent=%+v err=%v", changed, agent, err)
	}
}
