package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func testValidDrillReceipt() *backupAdminDrillReceipt {
	now := time.Now().UTC().Format(time.RFC3339)
	return &backupAdminDrillReceipt{
		Protocol:    "xdrive-host-isolated-drill-v1",
		State:       "success",
		Environment: "host_ephemeral_offline_tmpfs",
		Snapshot:    "xdrive-backup-20261027T030000Z",
		StartedAt:   now, FinishedAt: now,
		FilesRestored: true, PostgreSQLRestored: true,
		ProductionVerified: false, MaxMiB: 1024,
	}
}

func TestAdminDrillRequiresExactV2SnapshotAndTypedConfirmation(t *testing.T) {
	s, dir := readyBackupAdminTestServer(t)
	valid := `{"action":"drill","snapshot_id":"` + testBackupID + `","confirmation":"DRILL ` + testBackupID + `"}`
	code, body := runBackupAdminAction(t, s, valid)
	if code != http.StatusAccepted {
		t.Fatalf("drill queue rejected: %d %s", code, body)
	}
	var request backupAdminRequest
	if err := readSafeBackupAdminJSON(dir, "backup-admin-request.json", 2048, &request); err != nil {
		t.Fatal(err)
	}
	if request.Action != "drill" || request.SnapshotID != testBackupID || request.Confirmation != "DRILL "+testBackupID {
		t.Fatalf("invalid Host drill request: %+v", request)
	}
	if err := os.Remove(filepath.Join(dir, "backup-admin-request.json")); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{
		`{"action":"drill","snapshot_id":"` + testBackupID + `","confirmation":"DRILL wrong"}`,
		`{"action":"drill","snapshot_id":"v1:xdrive-backup-20261026T030000Z","confirmation":"DRILL v1:xdrive-backup-20261026T030000Z"}`,
		`{"action":"drill","snapshot_id":"` + testBackupID + `","confirmation":"DRILL ` + testBackupID + `","max_mib":8192}`,
		`{"action":"drill","snapshot_id":"v2-default:../../etc","confirmation":"DRILL v2-default:../../etc"}`,
	} {
		code, _ := runBackupAdminAction(t, s, body)
		if code != http.StatusBadRequest {
			t.Errorf("accepted unsafe drill request: %s status %d", body, code)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "backup-admin-request.json")); !os.IsNotExist(err) {
		t.Fatalf("unsafe drill accepted: %v", err)
	}
}

func TestAdminDrillHistoryRejectsForgeryAndNeverClaimsProductionAcceptance(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	base := backupAdminHistoryEntry{
		backupAdminStatus: backupAdminStatus{
			Protocol: backupAdminProtocol, RequestID: "0123456789abcdef01234567",
			Action: "drill", SnapshotID: testBackupID, State: "success",
			StartedAt: now, FinishedAt: now,
		},
		Drill: testValidDrillReceipt(),
	}
	if !validBackupAdminHistory([]backupAdminHistoryEntry{base}) {
		t.Fatal("real complete Host drill evidence rejected")
	}
	invalid := []backupAdminHistoryEntry{
		{backupAdminStatus: base.backupAdminStatus},
		{backupAdminStatus: base.backupAdminStatus, Drill: &backupAdminDrillReceipt{}},
	}
	modified := base
	receipt := *base.Drill
	receipt.ProductionVerified = true
	modified.Drill = &receipt
	invalid = append(invalid, modified)
	modified = base
	receipt = *base.Drill
	receipt.Snapshot = "xdrive-backup-20260101T000000Z"
	modified.Drill = &receipt
	invalid = append(invalid, modified)
	modified = base
	receipt = *base.Drill
	receipt.PostgreSQLRestored = false
	modified.Drill = &receipt
	invalid = append(invalid, modified)
	modified = base
	receipt = *base.Drill
	receipt.MaxMiB = 8192
	modified.Drill = &receipt
	invalid = append(invalid, modified)
	modified = base
	receipt = *base.Drill
	receipt.State = "failed"
	modified.Drill = &receipt
	invalid = append(invalid, modified)
	for i, v := range invalid {
		if validBackupAdminHistory([]backupAdminHistoryEntry{v}) {
			t.Errorf("forged Host proof accepted at %d", i)
		}
	}
	e := base
	e.State = "failed"
	e.Drill = nil
	e.ErrorCode = "operation_failed"
	if !validBackupAdminHistory([]backupAdminHistoryEntry{e}) {
		t.Fatal("failed drill without a valid Host report must remain visible as failed")
	}
	// JSON contract has no production-success field or host paths.
	raw, err := json.Marshal(base.Drill)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err = json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["production_verified"] != false || decoded["snapshot"] != "xdrive-backup-20261027T030000Z" {
		t.Fatalf("drill proof compromised: %s", string(raw))
	}
}
