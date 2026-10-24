package main

import (
	"context"
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
