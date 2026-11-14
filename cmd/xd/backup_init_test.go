package main

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
)

type fakeBootstrapAgent struct {
	preflightErr          error
	createErr             error
	bindErr               error
	scheduleErr           error
	readScheduleOverride  *localbackupipc.Schedule
	savedScheduleOverride *localbackupipc.Schedule
	preflighted           int
	created               int
	bound                 int
	saved                 int
}

func (f *fakeBootstrapAgent) PreflightLocalRoot(context.Context, string) error {
	f.preflighted++
	return f.preflightErr
}
func (f *fakeBootstrapAgent) CreateLocalBackupSource(_ context.Context, name string) (localbackupipc.LocalBackupSource, error) {
	f.created++
	if f.createErr != nil {
		return localbackupipc.LocalBackupSource{}, f.createErr
	}
	target := uint64(77) // assigned by the Server, never supplied by xd
	return localbackupipc.LocalBackupSource{
		ID: 42, Name: name, Revision: 1, Kind: "local_folder",
		Direction: "push", SyncMode: "backup", Status: "paused",
		TargetNodeID: &target, TargetManaged: true,
		TargetPath: "同步文件夹/Push/device_123456789abc/" + name,
	}, nil
}
func (f *fakeBootstrapAgent) AuthorizeLocalRoot(_ context.Context, sourceID uint64, path string) (localbackupipc.LocalBackupRootGrant, error) {
	f.bound++
	if f.bindErr != nil {
		return localbackupipc.LocalBackupRootGrant{}, f.bindErr
	}
	return localbackupipc.LocalBackupRootGrant{
		SourceID: sourceID, Path: path, StrongIdentity: true,
		Status: "awaiting_executor",
	}, nil
}
func (f *fakeBootstrapAgent) ReadSchedule(_ context.Context, id uint64) (localbackupipc.Schedule, error) {
	if f.scheduleErr != nil {
		return localbackupipc.Schedule{}, f.scheduleErr
	}
	if f.readScheduleOverride != nil {
		return *f.readScheduleOverride, nil
	}
	return localbackupipc.Schedule{SourceID: id, Revision: 1, ScheduleType: "manual"}, nil
}
func (f *fakeBootstrapAgent) SaveSchedule(_ context.Context, id, revision uint64, spec localbackupipc.Schedule) (localbackupipc.Schedule, error) {
	f.saved++
	if f.scheduleErr != nil {
		return localbackupipc.Schedule{}, f.scheduleErr
	}
	if f.savedScheduleOverride != nil {
		return *f.savedScheduleOverride, nil
	}
	spec.Revision = revision + 1
	return spec, nil
}

type fakeInitOnceAgent struct {
	*fakeBootstrapAgent
	starts int
	result localbackupipc.Summary
}

func (f *fakeInitOnceAgent) Start(_ context.Context, id uint64) (localbackupipc.Summary, error) {
	f.starts++
	if id != f.result.SourceID {
		return localbackupipc.Summary{}, errors.New("unexpected Source")
	}
	return f.result, nil
}

func (f *fakeInitOnceAgent) Status(context.Context, uint64) (localbackupipc.Summary, error) {
	return localbackupipc.Summary{}, errors.New("unexpected status poll")
}

func TestHeadlessInitRunNowUsesSameAgentOnlyAfterVerifiedBootstrap(t *testing.T) {
	root := filepath.Join(t.TempDir(), "photos")
	spec := sourceschedule.Spec{Type: "interval", Expression: "6h"}
	makeAgent := func() *fakeInitOnceAgent {
		return &fakeInitOnceAgent{
			fakeBootstrapAgent: &fakeBootstrapAgent{},
			result: localbackupipc.Summary{SourceID: 42, Revision: 2, State: "partial",
				InspectedFiles: 1, ConfirmedFiles: 1, ScanComplete: true},
		}
	}
	t.Run("explicit_start", func(t *testing.T) {
		agent := makeAgent()
		var out bytes.Buffer
		id, err := runBackupInitAndMaybeOnce(context.Background(), agent,
			"Photos", root, spec, true, &out)
		if err != nil || id != 42 || agent.starts != 1 || agent.saved != 1 ||
			agent.bound != 1 || !strings.Contains(out.String(), "uploaded=1") {
			t.Fatalf("run-now did not reuse verified owning Agent: id=%d err=%v agent=%+v output=%q",
				id, err, agent, out.String())
		}
	})
	t.Run("default_no_implicit_upload", func(t *testing.T) {
		agent := makeAgent()
		id, err := runBackupInitAndMaybeOnce(context.Background(), agent,
			"Photos", root, spec, false, &bytes.Buffer{})
		if err != nil || id != 42 || agent.starts != 0 || agent.saved != 1 {
			t.Fatalf("default init unexpectedly started an upload: id=%d err=%v agent=%+v",
				id, err, agent)
		}
	})
	t.Run("schedule_failure_never_starts", func(t *testing.T) {
		agent := makeAgent()
		agent.scheduleErr = errors.New("unconfirmed schedule revision")
		id, err := runBackupInitAndMaybeOnce(context.Background(), agent,
			"Photos", root, spec, true, &bytes.Buffer{})
		if err == nil || id != 42 || agent.starts != 0 {
			t.Fatalf("schedule failure started unsafe upload: id=%d err=%v agent=%+v",
				id, err, agent)
		}
	})
}

func TestHeadlessInitRefusesUnverifiedPlanAckBeforeRunNow(t *testing.T) {
	root := filepath.Join(t.TempDir(), "files")
	spec := sourceschedule.Spec{Type: "interval", Expression: "6h"}
	for _, tc := range []struct {
		name       string
		read       *localbackupipc.Schedule
		write      *localbackupipc.Schedule
		wantWrites int
	}{
		{
			name: "read_different_source",
			read: &localbackupipc.Schedule{SourceID: 99, Revision: 1, ScheduleType: "manual"},
		},
		{
			name: "read_without_revision",
			read: &localbackupipc.Schedule{SourceID: 42, ScheduleType: "manual"},
		},
		{
			name:       "saved_different_source",
			write:      &localbackupipc.Schedule{SourceID: 99, Revision: 2, ScheduleType: "interval", ScheduleExpression: "6h"},
			wantWrites: 1,
		},
		{
			name:       "saved_stale_revision",
			write:      &localbackupipc.Schedule{SourceID: 42, Revision: 1, ScheduleType: "interval", ScheduleExpression: "6h"},
			wantWrites: 1,
		},
		{
			name:       "saved_wrong_interval",
			write:      &localbackupipc.Schedule{SourceID: 42, Revision: 2, ScheduleType: "interval", ScheduleExpression: "12h"},
			wantWrites: 1,
		},
		{
			name:       "saved_invalid_readiness",
			write:      &localbackupipc.Schedule{SourceID: 42, Revision: 2, ScheduleType: "interval", ScheduleExpression: "6h", AutoReadiness: "unverified_from_elsewhere"},
			wantWrites: 1,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			agent := &fakeInitOnceAgent{
				fakeBootstrapAgent: &fakeBootstrapAgent{
					readScheduleOverride: tc.read, savedScheduleOverride: tc.write,
				},
				result: localbackupipc.Summary{SourceID: 42, Revision: 2, State: "partial"},
			}
			id, err := runBackupInitAndMaybeOnce(context.Background(), agent,
				"NAS Files", root, spec, true, &bytes.Buffer{})
			if id != 42 || err == nil || agent.starts != 0 ||
				agent.bound != 1 || agent.saved != tc.wantWrites ||
				!strings.Contains(err.Error(), "inspect its plan") {
				t.Fatalf("unverified schedule must retain bound Source without upload: id=%d err=%v agent=%+v",
					id, err, agent)
			}
		})
	}
}

func TestHeadlessInitAlreadySavedPlanDoesNotInvalidateCheckpoint(t *testing.T) {
	root := filepath.Join(t.TempDir(), "files")
	agent := &fakeInitOnceAgent{
		fakeBootstrapAgent: &fakeBootstrapAgent{
			readScheduleOverride: &localbackupipc.Schedule{
				SourceID: 42, Revision: 5, ScheduleType: "interval", ScheduleExpression: "6h",
			},
		},
		result: localbackupipc.Summary{SourceID: 42, Revision: 5, State: "partial",
			InspectedFiles: 1, ConfirmedFiles: 1, ScanComplete: true},
	}
	id, err := runBackupInitAndMaybeOnce(context.Background(), agent,
		"NAS Files", root, sourceschedule.Spec{Type: "interval", Expression: "6h"},
		true, &bytes.Buffer{})
	if err != nil || id != 42 || agent.saved != 0 || agent.starts != 1 {
		t.Fatalf("already saved plan was rewritten or first run skipped: id=%d err=%v agent=%+v",
			id, err, agent)
	}
}

func TestHeadlessInitReusesOwningAgentAndArmsOnlyAfterOnce(t *testing.T) {
	root := filepath.Join(t.TempDir(), "files")
	agent := &fakeBootstrapAgent{}
	spec := sourceschedule.Spec{Type: "interval", Expression: "6h"}
	var out bytes.Buffer
	id, err := runBackupInit(context.Background(), agent, "Photos", root, spec, &out)
	if err != nil || id != 42 {
		t.Fatalf("init failed: source=%d err=%v", id, err)
	}
	if agent.preflighted != 1 || agent.created != 1 || agent.bound != 1 || agent.saved != 1 {
		t.Fatalf("init did not reuse exactly one Agent: %+v", agent)
	}
	if !strings.Contains(out.String(), "xd backup once --source 42") ||
		strings.Contains(out.String(), "backup_complete") {
		t.Fatalf("initialization output falsely certifies a completed run: %q", out.String())
	}
}

func TestHeadlessInitFailClosedBeforeSourceOrWithRecoverableDraft(t *testing.T) {
	root := filepath.Join(t.TempDir(), "files")
	t.Run("invalid_local_root", func(t *testing.T) {
		agent := &fakeBootstrapAgent{preflightErr: errors.New("unsafe symlink")}
		id, err := runBackupInit(context.Background(), agent, "Photos", root, sourceschedule.Spec{}, &bytes.Buffer{})
		if err == nil || id != 0 || agent.created != 0 || agent.bound != 0 {
			t.Fatalf("preflight created an unauthorized Source: id=%d err=%v agent=%+v", id, err, agent)
		}
	})
	t.Run("unconfirmed_creation", func(t *testing.T) {
		agent := &fakeBootstrapAgent{createErr: errors.New("lost HTTP ack")}
		id, err := runBackupInit(context.Background(), agent, "Photos", root, sourceschedule.Spec{}, &bytes.Buffer{})
		if err == nil || id != 0 || agent.bound != 0 ||
			!strings.Contains(err.Error(), "xd backup drafts") {
			t.Fatalf("unconfirmed creation retried or claimed success: id=%d err=%v", id, err)
		}
	})
	t.Run("failed_root_bind", func(t *testing.T) {
		agent := &fakeBootstrapAgent{bindErr: errors.New("permission denied")}
		id, err := runBackupInit(context.Background(), agent, "Photos", root, sourceschedule.Spec{}, &bytes.Buffer{})
		if err == nil || id != 42 || agent.saved != 0 ||
			!strings.Contains(err.Error(), "xd backup bind --source 42") {
			t.Fatalf("failed Root binding was not preserved as a draft: id=%d err=%v", id, err)
		}
	})
	t.Run("failed_schedule", func(t *testing.T) {
		agent := &fakeBootstrapAgent{scheduleErr: errors.New("changed Source revision")}
		id, err := runBackupInit(context.Background(), agent, "Photos", root, sourceschedule.Spec{Type: "interval", Expression: "6h"}, &bytes.Buffer{})
		if err == nil || id != 42 || agent.bound != 1 ||
			!strings.Contains(err.Error(), "Source 42") {
			t.Fatalf("ambiguous schedule reported success: id=%d err=%v", id, err)
		}
	})
}

func TestHeadlessInitRequiresExplicitAbsoluteRootAndValidName(t *testing.T) {
	if _, err := normalizedExplicitBackupPath("relative/photos"); err == nil {
		t.Fatal("relative backup path accepted")
	}
	agent := &fakeBootstrapAgent{}
	_, err := runBackupInit(context.Background(), agent, "",
		filepath.Join(t.TempDir(), "photos"), sourceschedule.Spec{}, &bytes.Buffer{})
	if err == nil || agent.preflighted != 0 || agent.created != 0 {
		t.Fatal("invalid Source name reached native preflight or Server creation")
	}
}
