package main

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeOwningMountAgent struct {
	modeErr    error
	mount      localbackupipc.MountSettings
	readCount  int
	writeCount int
	written    string
}

func (f *fakeOwningMountAgent) RequireFullMode() error { return f.modeErr }

func (f *fakeOwningMountAgent) MountSettings(context.Context) (localbackupipc.MountSettings, error) {
	f.readCount++
	return f.mount, nil
}

func (f *fakeOwningMountAgent) UpdateMountPath(_ context.Context, path string) (localbackupipc.MountSettings, error) {
	f.writeCount++
	f.written = path
	return f.mount, nil
}

func TestMountUsesOwningAgentInsteadOfLocalMountRunner(t *testing.T) {
	root := filepath.Join(t.TempDir(), "xdrive")
	agent := &fakeOwningMountAgent{mount: localbackupipc.MountSettings{MountPath: root}}
	result, err := requestAgentMount(context.Background(), agent, "")
	if err != nil || result.MountPath != root {
		t.Fatalf("read-only existing Agent mount failed: %+v %v", result, err)
	}
	if agent.readCount != 1 || agent.writeCount != 0 {
		t.Fatalf("mount unexpectedly changed config: %+v", agent)
	}
	_, err = requestAgentMount(context.Background(), agent, root)
	if err != nil {
		t.Fatal(err)
	}
	if agent.writeCount != 1 || agent.written != root {
		t.Fatalf("xd mount did not use Agent settings: %+v", agent)
	}
}

func TestMountRefusesBackupOnlyAndUnknownModesBeforeChange(t *testing.T) {
	root := filepath.Join(t.TempDir(), "xdrive")
	for _, message := range []string{
		"backup-only Agent is running",
		"unknown Agent runtime mode",
	} {
		agent := &fakeOwningMountAgent{modeErr: errors.New(message),
			mount: localbackupipc.MountSettings{MountPath: root}}
		if _, err := requestAgentMount(context.Background(), agent, root); err == nil ||
			!strings.Contains(err.Error(), message) {
			t.Fatalf("mount should refuse incompatible Agent mode: %v", err)
		}
		if agent.readCount != 0 || agent.writeCount != 0 {
			t.Fatalf("mount called Agent settings after mode denial: %+v", agent)
		}
	}
}

func TestMountRequiresValidVerifiedDestination(t *testing.T) {
	root := filepath.Join(t.TempDir(), "xdrive")
	other := filepath.Join(t.TempDir(), "other")
	agent := &fakeOwningMountAgent{mount: localbackupipc.MountSettings{MountPath: other}}
	if _, err := requestAgentMount(context.Background(), agent, root); err == nil {
		t.Fatal("Agent acknowledgement for a different mount root was accepted")
	}
	if _, err := requestAgentMount(context.Background(), agent, "relative/path"); err == nil {
		t.Fatal("relative mount root was accepted")
	}
	if agent.writeCount != 1 {
		t.Fatalf("invalid relative root reached Agent: %+v", agent)
	}
	if _, err := requestAgentMount(context.Background(), nil, root); err == nil {
		t.Fatal("missing owning Agent accepted")
	}
}
