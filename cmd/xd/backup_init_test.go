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
	preflightErr error
	createErr    error
	bindErr      error
	scheduleErr  error
	preflighted  int
	created      int
	bound        int
	saved        int
}

func (f *fakeBootstrapAgent) PreflightLocalRoot(context.Context, string) error {
	f.preflighted++
	return f.preflightErr
}
func (f *fakeBootstrapAgent) CreateLocalBackupSource(_ context.Context, name string, target uint64) (localbackupipc.LocalBackupSource, error) {
	f.created++
	if f.createErr != nil {
		return localbackupipc.LocalBackupSource{}, f.createErr
	}
	return localbackupipc.LocalBackupSource{
		ID: 42, Name: name, Revision: 1, Kind: "local_folder",
		Direction: "push", SyncMode: "backup", Status: "paused",
		TargetNodeID: &target,
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
	return localbackupipc.Schedule{SourceID: id, Revision: 1, ScheduleType: "manual"}, nil
}
func (f *fakeBootstrapAgent) SaveSchedule(_ context.Context, id, revision uint64, spec localbackupipc.Schedule) (localbackupipc.Schedule, error) {
	f.saved++
	if f.scheduleErr != nil {
		return localbackupipc.Schedule{}, f.scheduleErr
	}
	spec.Revision = revision + 1
	return spec, nil
}

func TestHeadlessInitReusesOwningAgentAndArmsOnlyAfterOnce(t *testing.T) {
	root := filepath.Join(t.TempDir(), "files")
	agent := &fakeBootstrapAgent{}
	spec := sourceschedule.Spec{Type: "interval", Expression: "6h"}
	var out bytes.Buffer
	id, err := runBackupInit(context.Background(), agent, "Photos", root, 12, spec, &out)
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
		id, err := runBackupInit(context.Background(), agent, "Photos", root,
			12, sourceschedule.Spec{}, &bytes.Buffer{})
		if err == nil || id != 0 || agent.created != 0 || agent.bound != 0 {
			t.Fatalf("preflight created an unauthorized Source: id=%d err=%v agent=%+v", id, err, agent)
		}
	})
	t.Run("unconfirmed_creation", func(t *testing.T) {
		agent := &fakeBootstrapAgent{createErr: errors.New("lost HTTP ack")}
		id, err := runBackupInit(context.Background(), agent, "Photos", root,
			12, sourceschedule.Spec{}, &bytes.Buffer{})
		if err == nil || id != 0 || agent.bound != 0 ||
			!strings.Contains(err.Error(), "xd backup drafts") {
			t.Fatalf("unconfirmed creation retried or claimed success: id=%d err=%v", id, err)
		}
	})
	t.Run("failed_root_bind", func(t *testing.T) {
		agent := &fakeBootstrapAgent{bindErr: errors.New("permission denied")}
		id, err := runBackupInit(context.Background(), agent, "Photos", root,
			12, sourceschedule.Spec{}, &bytes.Buffer{})
		if err == nil || id != 42 || agent.saved != 0 ||
			!strings.Contains(err.Error(), "xd backup bind --source 42") {
			t.Fatalf("failed Root binding was not preserved as a draft: id=%d err=%v", id, err)
		}
	})
	t.Run("failed_schedule", func(t *testing.T) {
		agent := &fakeBootstrapAgent{scheduleErr: errors.New("changed Source revision")}
		id, err := runBackupInit(context.Background(), agent, "Photos", root,
			12, sourceschedule.Spec{Type: "interval", Expression: "6h"}, &bytes.Buffer{})
		if err == nil || id != 42 || agent.bound != 1 ||
			!strings.Contains(err.Error(), "Source 42") {
			t.Fatalf("ambiguous schedule reported success: id=%d err=%v", id, err)
		}
	})
}

func TestHeadlessInitRequiresExplicitAbsoluteRootAndValidTarget(t *testing.T) {
	if _, err := normalizedExplicitBackupPath("relative/photos"); err == nil {
		t.Fatal("relative backup path accepted")
	}
	agent := &fakeBootstrapAgent{}
	_, err := runBackupInit(context.Background(), agent, "Photos",
		filepath.Join(t.TempDir(), "photos"), 0, sourceschedule.Spec{}, &bytes.Buffer{})
	if err == nil || agent.preflighted != 0 {
		t.Fatal("invalid target created Source")
	}
}
