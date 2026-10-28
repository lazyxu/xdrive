package api

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func validBulkReportTestValue() backupAdminVerifyAllReport {
	now := time.Now().UTC().Format(time.RFC3339)
	var r backupAdminVerifyAllReport
	r.Protocol = "xdrive-host-verify-all-v1"
	r.RequestID = "0123456789abcdef01234567"
	r.Mode = "fast"
	r.State = "success"
	r.StartedAt = now
	r.FinishedAt = now
	r.TotalSnapshots = 2
	r.CheckedSnapshots = 2
	r.PassedSnapshots = 2
	r.FailureSample = []backupAdminVerifyAllFailure{}
	return r
}

func TestAdminBulkVerificationSourceBoundReport(t *testing.T) {
	valid := validBulkReportTestValue()
	if !validBackupAdminVerifyAllReport(valid) {
		t.Fatal("valid complete Host report rejected")
	}
	invalid := make([]backupAdminVerifyAllReport, 0, 18)
	copy := valid
	copy.Protocol = "fake"
	invalid = append(invalid, copy)
	copy = valid
	copy.RequestID = "another"
	invalid = append(invalid, copy)
	copy = valid
	copy.PassedSnapshots = 1
	invalid = append(invalid, copy)
	copy = valid
	copy.TotalSnapshots = 1001
	invalid = append(invalid, copy)
	copy = valid
	copy.State = "failed"
	invalid = append(invalid, copy)
	copy = valid
	copy.UnverifiedSnapshots = 1
	invalid = append(invalid, copy)
	copy = valid
	copy.PassedSnapshots = 1 << 30
	copy.FailedSnapshots = 1 << 30
	invalid = append(invalid, copy)
	copy = valid
	copy.DeepRepositoriesChecked = 1
	invalid = append(invalid, copy)
	copy = valid
	copy.Mode = "unsafe"
	invalid = append(invalid, copy)
	copy = valid
	copy.FailureSampleTruncated = true
	invalid = append(invalid, copy)
	copy = valid
	copy.FailureCategory = "arbitrary shell output"
	invalid = append(invalid, copy)
	copy = valid
	copy.FinishedAt = "bad"
	invalid = append(invalid, copy)
	copy = valid
	copy.FailureSample = []backupAdminVerifyAllFailure{{SnapshotID: "v1:../../etc/shadow", Category: "missing_object"}}
	invalid = append(invalid, copy)
	for i, item := range invalid {
		if validBackupAdminVerifyAllReport(item) {
			t.Errorf("unsafe or inconsistent Host batch report accepted at %d", i)
		}
	}
}

func TestAdminBulkVerificationFailureIsVisibleButNeverGreen(t *testing.T) {
	r := validBulkReportTestValue()
	r.State = "failed"
	r.PassedSnapshots = 1
	r.FailedSnapshots = 1
	r.FailureSample = []backupAdminVerifyAllFailure{{
		SnapshotID: "v2-default:xdrive-backup-20261027T030000Z",
		Category: "object_sha256_mismatch",
	}}
	if !validBackupAdminVerifyAllReport(r) {
		t.Fatal("real failed batch report incorrectly rejected")
	}
	r.FailureSample[0].Category = "/private/host/path"
	if validBackupAdminVerifyAllReport(r) {
		t.Fatal("raw Host paths must not be accepted as failure categories")
	}
	r = validBulkReportTestValue()
	r.State = "failed"
	r.TotalSnapshots = 0
	r.CheckedSnapshots = 0
	r.PassedSnapshots = 0
	r.FailureCategory = "snapshot_limit_exceeded"
	if !validBackupAdminVerifyAllReport(r) {
		t.Fatal("bounded refusal must be reported, never passed")
	}
}

func TestAdminBulkVerificationReadOnlyStatusAndExactHostHistory(t *testing.T) {
	s, dir := readyBackupAdminTestServer(t)
	r := validBulkReportTestValue()
	writeBackupTestJSON(t, dir, "backup-admin-verify-all-report.json", r)
	page := s.backupAdminState()
	if !page.Supported || page.BulkVerification == nil || page.BulkVerification.State != "success" {
		t.Fatalf("missing valid host batch summary: %+v", page)
	}
	if err := os.Remove(filepath.Join(dir, "backup-admin-verify-all-report.json")); err != nil {
		t.Fatal(err)
	}
	r.TotalSnapshots = 9999
	writeBackupTestJSON(t, dir, "backup-admin-verify-all-report.json", r)
	if got := s.backupAdminState(); got.BulkVerification != nil {
		t.Fatal("invalid Host report was surfaced")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	entry := backupAdminHistoryEntry{
		backupAdminStatus: backupAdminStatus{
			Protocol: backupAdminProtocol,
			RequestID: "0123456789abcdef01234567",
			Action: "verify_all",
			State: "failed",
			StartedAt: now,
			FinishedAt: now,
			ErrorCode: "operation_failed",
		},
		Mode: "deep",
	}
	if !validBackupAdminHistory([]backupAdminHistoryEntry{entry}) {
		t.Fatal("interrupted batch verification history must remain readable")
	}
	entry.SnapshotID = testBackupID
	if validBackupAdminHistory([]backupAdminHistoryEntry{entry}) {
		t.Fatal("batch history must not claim an unrelated selected snapshot")
	}
}
