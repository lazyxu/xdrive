package api

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBackupAdminDBOnlyRestoreRequiresExactHostInventory(t *testing.T) {
	const id = "v1:xdrive-backup-20261026T030000Z"
	server, dir := readyBackupAdminTestServer(t)
	inventory := backupAdminInventory{
		Protocol: backupAdminProtocol, GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Policy: backupAdminPolicy{ScheduleFormat: "v1", RetentionDays: 7, Revision: testPolicyRevision},
		Snapshots: []backupAdminSnapshot{
			{ID: id, Name: "xdrive-backup-20261026T030000Z", Format: "v1",
				State: "complete", FileDataIncluded: false, CreatedAt: "2026-10-26T03:00:00Z"},
			{ID: testBackupID, Name: "xdrive-backup-20261027T030000Z", Format: "v2",
				State: "complete", FileDataIncluded: true, CreatedAt: "2026-10-27T03:00:00Z"},
		},
	}
	writeBackupTestJSON(t, dir, "backup-admin-inventory.json", inventory)
	invalid := []string{
		`{"action":"restore_database_only","snapshot_id":"`+id+`","confirmation":"RESTORE `+id+`"}`,
		`{"action":"restore_database_only","snapshot_id":"`+testBackupID+`","confirmation":"DATABASE ONLY RESTORE `+testBackupID+`"}`,
		`{"action":"restore_database_only","snapshot_id":"v1:../../etc","confirmation":"DATABASE ONLY RESTORE v1:../../etc"}`,
		`{"action":"restore_database_only","snapshot_id":"`+id+`","confirmation":"DATABASE ONLY RESTORE `+id+`","repository_dir":"/etc"}`,
	}
	for _, payload := range invalid {
		code, _ := runBackupAdminAction(t, server, payload)
		if code != http.StatusBadRequest {
			t.Fatalf("invalid DB-only request accepted: code=%d, %s", code, payload)
		}
		if _, err := os.Stat(filepath.Join(dir, "backup-admin-request.json")); !os.IsNotExist(err) {
			t.Fatalf("invalid request wrote Host queue: %v", err)
		}
	}
	id2 := "v1:xdrive-backup-20261025T030000Z"
	inventory.Snapshots = append(inventory.Snapshots, backupAdminSnapshot{
		ID: id2, Name: "xdrive-backup-20261025T030000Z", Format: "v1",
		State: "complete", FileDataIncluded: true, CreatedAt: "2026-10-25T03:00:00Z",
	})
	writeBackupTestJSON(t, dir, "backup-admin-inventory.json", inventory)
	body := `{"action":"restore_database_only","snapshot_id":"`+id2+`","confirmation":"DATABASE ONLY RESTORE `+id2+`"}`
	if code, _ := runBackupAdminAction(t, server, body); code != http.StatusConflict {
		t.Fatalf("full v1 backup accepted as DB-only: %d", code)
	}
	inventory.Snapshots[0].State = "inconsistent"
	writeBackupTestJSON(t, dir, "backup-admin-inventory.json", inventory)
	body = `{"action":"restore_database_only","snapshot_id":"`+id+`","confirmation":"DATABASE ONLY RESTORE `+id+`"}`
	if code, _ := runBackupAdminAction(t, server, body); code != http.StatusConflict {
		t.Fatalf("inconsistent DB-only snapshot accepted for destructive recovery: %d", code)
	}
	inventory.Snapshots[0].State = "complete"
	writeBackupTestJSON(t, dir, "backup-admin-inventory.json", inventory)
	if code, response := runBackupAdminAction(t, server, body); code != http.StatusAccepted {
		t.Fatalf("valid DB-only restore rejected: code=%d, body=%s", code, response)
	}
	var queued backupAdminRequest
	if err := readSafeBackupAdminJSON(dir, "backup-admin-request.json", 2048, &queued); err != nil {
		t.Fatal(err)
	}
	if queued.Action != "restore_database_only" || queued.SnapshotID != id ||
		queued.Confirmation != "DATABASE ONLY RESTORE "+id ||
		queued.Mode != "" || queued.Format != "" {
		t.Fatalf("incorrect fixed Host restore request: %+v", queued)
	}
}

func TestBackupAdminDBOnlyHistoryCannotMasqueradeAsFullRestore(t *testing.T) {
	record := backupAdminHistoryEntry{
		backupAdminStatus: backupAdminStatus{
			Protocol: backupAdminProtocol,
			RequestID: "abcdef123456abcdef123456",
			Action: "restore_database_only", SnapshotID: "v1:xdrive-backup-20261026T030000Z",
			State: "success", StartedAt: "2026-10-28T02:00:00Z", FinishedAt: "2026-10-28T02:01:00Z",
		},
	}
	if !validBackupAdminHistory([]backupAdminHistoryEntry{record}) {
		t.Fatal("valid DB-only Host history rejected")
	}
	record.SnapshotID = testBackupID
	if validBackupAdminHistory([]backupAdminHistoryEntry{record}) {
		t.Fatal("v2 record masquerading as DB-only history accepted")
	}
}
