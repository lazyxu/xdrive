package api

import (
	"fmt"
	"testing"
)

func TestBackupAdminAcceptsHundredHostHistoryReceipts(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	events := make([]backupAdminHistoryEntry, 0, 101)
	for i := 1; i <= 100; i++ {
		events = append(events, backupAdminHistoryEntry{
			backupAdminStatus: backupAdminStatus{
				Protocol:  backupAdminProtocol,
				RequestID: fmt.Sprintf("%024x", i),
				Action:    "verify", SnapshotID: testBackupID,
				State: "success", StartedAt: "2026-10-27T03:00:00Z",
				FinishedAt: "2026-10-27T03:00:01Z",
			},
			Mode: "fast",
		})
	}
	writeBackupTestJSON(t, dir, "backup-admin-history.json", backupAdminHistory{
		Protocol: "xdrive-backup-admin-history-v1", Operations: events,
	})
	page := server.backupAdminState()
	if !page.Supported || len(page.History) != 100 {
		t.Fatalf("valid 100-entry history rejected: supported=%v history=%d", page.Supported, len(page.History))
	}
	events = append(events, backupAdminHistoryEntry{
		backupAdminStatus: backupAdminStatus{
			Protocol:  backupAdminProtocol,
			RequestID: "000000000000000000000065",
			Action:    "verify", SnapshotID: testBackupID,
			State: "success", StartedAt: "2026-10-27T03:00:00Z",
			FinishedAt: "2026-10-27T03:00:01Z",
		},
		Mode: "fast",
	})
	writeBackupTestJSON(t, dir, "backup-admin-history.json", backupAdminHistory{
		Protocol: "xdrive-backup-admin-history-v1", Operations: events,
	})
	page = server.backupAdminState()
	if !page.Supported || len(page.History) != 0 {
		t.Fatalf("over-limit history accepted: supported=%v history=%d", page.Supported, len(page.History))
	}
}
