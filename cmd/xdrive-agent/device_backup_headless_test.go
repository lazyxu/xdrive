package main

import (
	"context"
	"errors"
	"testing"
)

func TestBackupOnlyFlagDoesNotChangeDesktopInvocation(t *testing.T) {
	cases := []struct {
		args []string
		want bool
		fail bool
	}{
		{args: nil},
		{args: []string{"--backup-only"}, want: true},
		{args: []string{"--backup-only", "--mount"}, fail: true},
		{args: []string{"--shell-action", "unregister"}},
	}
	for _, tc := range cases {
		got, err := agentBackupOnlyRequested(tc.args)
		if got != tc.want || (err != nil) != tc.fail {
			t.Fatalf("args=%q mode=%v err=%v", tc.args, got, err)
		}
	}
}

func TestBackupOnlyAgentLifecycleDoesNotRequireMountedDrive(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	c := &agentController{ctx: ctx}
	// Cancellation must terminate the backup-only process even when no
	// account, mount path or Desktop session is configured.
	cancel()
	c.RunBackupOnly()
}

func TestBackupOnlyRequiresAuthenticatedIPCBeforeScheduling(t *testing.T) {
	failure := errors.New("local IPC port unavailable")
	for _, tc := range []struct {
		name       string
		backupOnly bool
		ipcErr     error
		want       bool
	}{
		{name: "backup_only_ready", backupOnly: true, want: true},
		{name: "backup_only_ipc_failed", backupOnly: true, ipcErr: failure, want: false},
		{name: "desktop_ready", want: true},
		{name: "desktop_ipc_optional", ipcErr: failure, want: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := agentIPCStartupPermitsWorker(tc.backupOnly, tc.ipcErr); got != tc.want {
				t.Fatalf("backupOnly=%v ipcErr=%v: worker admission=%v want=%v",
					tc.backupOnly, tc.ipcErr, got, tc.want)
			}
		})
	}
}
