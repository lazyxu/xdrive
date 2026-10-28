package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func readySelectedDeletionTestServer(t *testing.T) (*Server, string, backupAdminSelectedPreview) {
	t.Helper()
	server, dir := readyBackupAdminTestServer(t)
	v := validSelectedPreviewFixture()
	v.Mode = "deep"
	v.Report.Validation = "snapshot_sha256_and_full_cas_sha256"
	v.Report.HashedObjects = v.Report.SelectedCASObjects + v.Report.UnreferencedObjects
	v.Report.HashedBytes = v.Report.ExclusiveCASBytes + v.Report.UnreferencedBytes
	writeBackupTestJSON(t, dir, "backup-admin-selected-preview.json", v)
	finished := time.Now().UTC().Format(time.RFC3339)
	writeBackupTestJSON(t, dir, "backup-admin-history.json", backupAdminHistory{
		Protocol: "xdrive-backup-admin-history-v1",
		Operations: []backupAdminHistoryEntry{{
			backupAdminStatus: backupAdminStatus{
				Protocol: backupAdminProtocol, State: "success", Action: "preview_delete",
				RequestID: v.RequestID, SnapshotID: v.SnapshotID,
				StartedAt: finished, FinishedAt: finished,
			},
			Mode: "deep",
		}},
	})
	writeBackupTestJSON(t, dir, "backup-admin-status.json", backupAdminStatus{
		Protocol: backupAdminProtocol, State: "success", Action: "preview_delete",
		RequestID: v.RequestID, SnapshotID: v.SnapshotID,
		FinishedAt: time.Now().UTC().Format(time.RFC3339),
	})
	return server, dir, v
}

func TestSelectedDeletionRejectsMissingFastStaleAndForeignPreview(t *testing.T) {
	cases := []struct {
		name string
		body string
		edit func(string, backupAdminSelectedPreview)
		want int
	}{
		{"missing receipt", `{"action":"delete_selected","snapshot_id":"` + testBackupID +
			`","confirmation":"DELETE ` + testBackupID + `"}`, nil, http.StatusBadRequest},
		{"invalid token", `{"action":"delete_selected","snapshot_id":"` + testBackupID +
			`","confirmation":"DELETE ` + testBackupID + `","preview_request_id":"invalid"}`, nil, http.StatusBadRequest},
		{"wrong token", `{"action":"delete_selected","snapshot_id":"` + testBackupID +
			`","confirmation":"DELETE ` + testBackupID + `","preview_request_id":"aaaaaaaaaaaaaaaaaaaaaaaa"}`, nil, http.StatusConflict},
		{"wrong confirmation", `{"action":"delete_selected","snapshot_id":"` + testBackupID +
			`","confirmation":"DELETE other","preview_request_id":"abcdef123456abcdef123456"}`, nil, http.StatusBadRequest},
		{"fast preview", "", func(dir string, v backupAdminSelectedPreview) {
			v.Mode = "fast"
			v.Report.Validation = "snapshot_sha256_and_cas_size"
			writeBackupTestJSON(t, dir, "backup-admin-selected-preview.json", v)
		}, http.StatusConflict},
		{"fake deep hashes", "", func(dir string, v backupAdminSelectedPreview) {
			v.Report.HashedObjects = 0
			v.Report.HashedBytes = 0
			writeBackupTestJSON(t, dir, "backup-admin-selected-preview.json", v)
		}, http.StatusConflict},
		{"missing Host history", "", func(dir string, v backupAdminSelectedPreview) {
			if err := os.Remove(filepath.Join(dir, "backup-admin-history.json")); err != nil {
				t.Fatal(err)
			}
		}, http.StatusConflict},
		{"stale history status", "", func(dir string, v backupAdminSelectedPreview) {
			writeBackupTestJSON(t, dir, "backup-admin-status.json", backupAdminStatus{
				Protocol: backupAdminProtocol, State: "success", Action: "verify",
				RequestID: v.RequestID, SnapshotID: v.SnapshotID,
				FinishedAt: time.Now().UTC().Format(time.RFC3339),
			})
		}, http.StatusConflict},
		{"expired", "", func(dir string, v backupAdminSelectedPreview) {
			writeBackupTestJSON(t, dir, "backup-admin-status.json", backupAdminStatus{
				Protocol: backupAdminProtocol, State: "success", Action: "preview_delete",
				RequestID: v.RequestID, SnapshotID: v.SnapshotID,
				FinishedAt: time.Now().Add(-16 * time.Minute).UTC().Format(time.RFC3339),
			})
		}, http.StatusConflict},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server, dir, preview := readySelectedDeletionTestServer(t)
			if tc.edit != nil {
				tc.edit(dir, preview)
			}
			body := tc.body
			if body == "" {
				body = `{"action":"delete_selected","snapshot_id":"` + testBackupID +
					`","confirmation":"DELETE ` + testBackupID +
					`","preview_request_id":"abcdef123456abcdef123456"}`
			}
			status, response := runBackupAdminAction(t, server, body)
			if status != tc.want {
				t.Fatalf("status %d want %d: %s", status, tc.want, response)
			}
			if status == http.StatusConflict && !strings.Contains(response, "backup_deep_preview_not_current") {
				t.Fatalf("missing precise conflict reason: %s", response)
			}
			if _, err := readSafeBackupAdminJSONForTest(filepath.Join(dir, "backup-admin-request.json")); err == nil {
				t.Fatal("unsafe selected deletion was queued")
			}
		})
	}
}

func readSafeBackupAdminJSONForTest(path string) ([]byte, error) {
	return os.ReadFile(path)
}

func TestSelectedDeletionQueuesExactConfirmedBoundedOperation(t *testing.T) {
	server, dir, v := readySelectedDeletionTestServer(t)
	body := `{"action":"delete_selected","snapshot_id":"` + testBackupID +
		`","confirmation":"DELETE ` + testBackupID +
		`","preview_request_id":"` + v.RequestID + `"}`
	status, response := runBackupAdminAction(t, server, body)
	if status != http.StatusAccepted {
		t.Fatalf("status=%d, %s", status, response)
	}
	var request backupAdminRequest
	if err := readSafeBackupAdminJSON(dir, "backup-admin-request.json", 2048, &request); err != nil {
		t.Fatal(err)
	}
	if request.Action != "delete_selected" || request.SnapshotID != testBackupID ||
		request.PreviewRequestID != v.RequestID || request.Confirmation != "DELETE "+testBackupID ||
		request.Mode != "" || request.KeepLast != 0 {
		t.Fatalf("unexpected selected deletion Host action: %+v", request)
	}
}
