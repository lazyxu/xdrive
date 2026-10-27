package main

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestDesktopAdminServerBackupFixedActionValidation(t *testing.T) {
	const id = "v2-default:xdrive-backup-20261027T030000Z"
	const old = "v1:xdrive-backup-20261026T030000Z"
	const revision = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	good := []client.AdminServerBackupRequest{
		{Action: "create", Format: "v1"}, {Action: "create", Format: "v2"},
		{Action: "verify", SnapshotID: id, Mode: "fast"},
		{Action: "verify", SnapshotID: id, Mode: "deep"},
		{Action: "plan", KeepLast: 2, Mode: "fast"},
		{Action: "restore", SnapshotID: id, Confirmation: "RESTORE " + id},
		{Action: "delete", SnapshotID: old, Confirmation: "DELETE " + old},
		{Action: "prune", KeepLast: 2, Confirmation: "PRUNE 2"},
		{Action: "policy", Format: "v2", RetentionDays: 30, Revision: revision},
	}
	for _, input := range good {
		if !validDesktopAdminServerBackupRequest(input) {
			t.Errorf("rejected fixed action %#v", input)
		}
	}
	bad := []client.AdminServerBackupRequest{
		{Action: "shell", Format: "v1"},
		{Action: "restore", SnapshotID: "v2-default:../../etc", Confirmation: "RESTORE v2-default:../../etc"},
		{Action: "restore", SnapshotID: id, Confirmation: "RESTORE " + old},
		{Action: "delete", SnapshotID: id, Confirmation: "DELETE " + id},
		{Action: "prune", KeepLast: 0, Confirmation: "PRUNE 0"},
		{Action: "prune", KeepLast: 2, Confirmation: "PRUNE 3"},
		{Action: "verify", SnapshotID: id, Mode: "shallow"},
		{Action: "create", Format: "v2", SnapshotID: id},
		{Action: "policy", Format: "v2", RetentionDays: 1, Revision: "stale"},
		{Action: "policy", Format: "v2", RetentionDays: 9999, Revision: revision},
	}
	for _, input := range bad {
		if validDesktopAdminServerBackupRequest(input) {
			t.Errorf("accepted unsafe action %#v", input)
		}
	}
}
