package api

import (
	"testing"
	"time"
)

func TestBackupSelectedDeleteReceiptBoundedAndSourceOwned(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	good := backupAdminHistoryEntry{
		backupAdminStatus: backupAdminStatus{
			Protocol: backupAdminProtocol, State: "success",
			RequestID: "abcdef123456abcdef123456", Action: "delete_selected",
			SnapshotID: testBackupID, StartedAt: now, FinishedAt: now,
		},
		SelectedDelete: &backupAdminSelectedDeleteReceipt{
			Mode:                     "manual_selected",
			KeepLast:                 1,
			RetiredSnapshots:         []string{"xdrive-backup-20261027T030000Z"},
			DeletedCASObjects:        1,
			DeletedCASLogicalBytes:   123,
			DeletedSnapshotFiles:     6,
			DeletedSnapshotFileBytes: 400,
			Verification:             "exclusive_lock_and_full_cas_sha256",
			Automatic:                false,
		},
	}
	if !validBackupSelectedDeleteHistory(good) ||
		!validBackupAdminHistory([]backupAdminHistoryEntry{good}) {
		t.Fatal("real bounded retirement proof rejected")
	}
	tests := []struct {
		name string
		edit func(*backupAdminHistoryEntry)
	}{
		{"missing proof", func(e *backupAdminHistoryEntry) { e.SelectedDelete = nil }},
		{"wrong snapshot", func(e *backupAdminHistoryEntry) {
			e.SelectedDelete.RetiredSnapshots = []string{"xdrive-backup-20261026T030000Z"}
		}},
		{"multiple snapshots", func(e *backupAdminHistoryEntry) {
			e.SelectedDelete.RetiredSnapshots = []string{"xdrive-backup-20261027T030000Z", "xdrive-backup-20261026T030000Z"}
		}},
		{"missing exclusive verification", func(e *backupAdminHistoryEntry) {
			e.SelectedDelete.Verification = "metadata_only"
		}},
		{"automatic", func(e *backupAdminHistoryEntry) { e.SelectedDelete.Automatic = true }},
		{"zero survivors", func(e *backupAdminHistoryEntry) { e.SelectedDelete.KeepLast = 0 }},
		{"negative count", func(e *backupAdminHistoryEntry) { e.SelectedDelete.DeletedCASObjects = -1 }},
		{"unrepresentable bytes", func(e *backupAdminHistoryEntry) {
			e.SelectedDelete.DeletedSnapshotFileBytes = 9007199254740992
		}},
		{"foreign action", func(e *backupAdminHistoryEntry) { e.Action = "verify" }},
		{"failed with fake success", func(e *backupAdminHistoryEntry) { e.State = "failed" }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			e := good
			copyReport := *good.SelectedDelete
			e.SelectedDelete = &copyReport
			tc.edit(&e)
			if validBackupSelectedDeleteHistory(e) {
				t.Fatalf("forged selected retirement proof was accepted: %+v", e)
			}
		})
	}
}
