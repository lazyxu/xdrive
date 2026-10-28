package api

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func validSelectedPreviewFixture() backupAdminSelectedPreview {
	return backupAdminSelectedPreview{
		Protocol:   "xdrive-host-selected-v2-preview-v1",
		RequestID:  "abcdef123456abcdef123456",
		SnapshotID: testBackupID,
		Mode:       "fast",
		Report: backupAdminSelectedPreviewPlan{
			Protocol:           "xdrive-backup-selected-prune-plan-v1",
			Mode:               "read_only",
			Validation:         "snapshot_sha256_and_cas_size",
			Snapshot:           "xdrive-backup-20261027T030000Z",
			CommittedSnapshots: 2, SurvivingSnapshots: 1,
			SelectedSnapshotBytes: 300,
			SelectedCASObjects:    3, SharedCASObjects: 2,
			ExclusiveCASObjects: 1, ExclusiveCASBytes: 100,
			UnreferencedObjects: 1, UnreferencedBytes: 50,
			PotentialLogicalBytes: 450, DeleteEnabled: false,
		},
	}
}

func TestSelectedPreviewFailsClosedOnForgedOrInconsistentReport(t *testing.T) {
	good := validSelectedPreviewFixture()
	if !validBackupAdminSelectedPreview(good) {
		t.Fatal("valid Host preview rejected")
	}
	deep := good
	deep.Mode = "deep"
	deep.Report.Validation = "snapshot_sha256_and_full_cas_sha256"
	deep.Report.HashedObjects = 4
	deep.Report.HashedBytes = 300
	if !validBackupAdminSelectedPreview(deep) {
		t.Fatal("valid deep preview rejected")
	}
	bad := []backupAdminSelectedPreview{}
	change := deep
	change.Report.HashedObjects = 3 // selected (3) plus orphan (1) require >= 4
	bad = append(bad, change)
	change = deep
	change.Report.HashedBytes = 149 // exclusive (100) plus orphan (50) require >= 150
	bad = append(bad, change)
	change = good
	change.Report.DeleteEnabled = true
	bad = append(bad, change)
	change = good
	change.Report.Snapshot = "xdrive-backup-20261026T030000Z"
	bad = append(bad, change)
	change = good
	change.Report.SurvivingSnapshots = 0
	bad = append(bad, change)
	change = good
	change.Report.PotentialLogicalBytes = 1000
	bad = append(bad, change)
	change = good
	change.Mode = "deep"
	bad = append(bad, change)
	change = good
	change.SnapshotID = "v1:xdrive-backup-20261026T030000Z"
	bad = append(bad, change)
	change = good
	change.Report.SelectedCASObjects = 4
	bad = append(bad, change)
	change = good
	change.Report.HashedBytes = 9007199254740992
	bad = append(bad, change)
	for i, v := range bad {
		if validBackupAdminSelectedPreview(v) {
			t.Fatalf("unsafe preview #%d accepted: %+v", i, v)
		}
	}
}

func TestSelectedPreviewReadRequiresMatchingRecentCompletedHostAction(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	v := validSelectedPreviewFixture()
	writeBackupTestJSON(t, dir, "backup-admin-selected-preview.json", v)
	writeBackupTestJSON(t, dir, "backup-admin-status.json", backupAdminStatus{
		Protocol: backupAdminProtocol, State: "success", Action: "preview_delete",
		RequestID: v.RequestID, SnapshotID: v.SnapshotID,
		FinishedAt: time.Now().UTC().Format(time.RFC3339),
	})
	finished := time.Now().UTC().Format(time.RFC3339)
	receipt := backupAdminHistory{
		Protocol: "xdrive-backup-admin-history-v1",
		Operations: []backupAdminHistoryEntry{{
			backupAdminStatus: backupAdminStatus{
				Protocol: backupAdminProtocol, State: "success", Action: "preview_delete",
				RequestID: v.RequestID, SnapshotID: v.SnapshotID,
				StartedAt: finished, FinishedAt: finished,
			},
			Mode: v.Mode,
		}},
	}
	writeBackupTestJSON(t, dir, "backup-admin-history.json", receipt)
	page := server.backupAdminState()
	if page.SelectedPreview == nil {
		t.Fatal("matching completed read-only preview not surfaced")
	}
	if err := os.Remove(filepath.Join(dir, "backup-admin-history.json")); err != nil {
		t.Fatal(err)
	}
	if page := server.backupAdminState(); page.SelectedPreview != nil {
		t.Fatal("preview surfaced without durable Host history receipt")
	}
	writeBackupTestJSON(t, dir, "backup-admin-history.json", receipt)
	writeBackupTestJSON(t, dir, "backup-admin-status.json", backupAdminStatus{
		Protocol: backupAdminProtocol, State: "success", Action: "verify",
		RequestID: v.RequestID, SnapshotID: v.SnapshotID,
		FinishedAt: time.Now().UTC().Format(time.RFC3339),
	})
	if page := server.backupAdminState(); page.SelectedPreview != nil {
		t.Fatal("old preview surfaced after a different operation")
	}
	if err := os.Remove(filepath.Join(dir, "backup-admin-selected-preview.json")); err != nil {
		t.Fatal(err)
	}
	if page := server.backupAdminState(); page.SelectedPreview != nil {
		t.Fatal("missing Host report was treated as valid")
	}
}

func TestSelectedPreviewFixedAdminActionQueuesOnlyReadOnlyHostRequest(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	status, response := runBackupAdminAction(t, server,
		`{"action":"preview_delete","snapshot_id":"`+testBackupID+`","mode":"deep"}`)
	if status != http.StatusAccepted {
		t.Fatalf("preview status=%d body=%s", status, response)
	}
	var request backupAdminRequest
	if err := readSafeBackupAdminJSON(dir, "backup-admin-request.json", 2048, &request); err != nil {
		t.Fatal(err)
	}
	if request.Action != "preview_delete" || request.Mode != "deep" ||
		request.SnapshotID != testBackupID || request.Confirmation != "" {
		t.Fatalf("unsafe action queued: %+v", request)
	}
}
