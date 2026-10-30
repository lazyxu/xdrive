package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBackupAdminSchedulePresetsRequireTypedRevisionAndConfirmation(t *testing.T) {
	for _, preset := range []string{"daily", "weekly", "disabled"} {
		request := backupAdminRequest{
			Action: "schedule", Preset: preset, Revision: testPolicyRevision,
			Confirmation: "SCHEDULE " + preset,
		}
		if err := validateBackupAdminRequest(request); err != nil {
			t.Fatalf("rejected fixed schedule preset %q: %v", preset, err)
		}
	}
	for _, request := range []backupAdminRequest{
		{Action: "schedule", Preset: "0 0 * * *", Revision: testPolicyRevision, Confirmation: "SCHEDULE 0 0 * * *"},
		{Action: "schedule", Preset: "daily; touch /tmp/x", Revision: testPolicyRevision, Confirmation: "SCHEDULE daily; touch /tmp/x"},
		{Action: "schedule", Preset: "daily", Revision: testPolicyRevision, Confirmation: "SCHEDULE weekly"},
		{Action: "schedule", Preset: "daily", Revision: "stale", Confirmation: "SCHEDULE daily"},
		{Action: "schedule", Preset: "disabled", Revision: testPolicyRevision, Confirmation: "SCHEDULE disabled", Format: "v1"},
		{Action: "schedule", Preset: "daily", Revision: testPolicyRevision, Confirmation: "SCHEDULE daily", SnapshotID: testBackupID},
		{Action: "verify_all", Preset: "daily", Mode: "fast"},
	} {
		if err := validateBackupAdminRequest(request); err == nil {
			t.Fatalf("accepted unsafe schedule or unrelated preset: %+v", request)
		}
	}
}

func TestBackupAdminScheduleRequiresFreshHostAttestation(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	page := server.backupAdminState()
	if !page.Supported {
		t.Fatal("missing trusted Host inventory")
	}
	page.Inventory.Schedule = &backupAdminScheduleStatus{
		Protocol:   "xdrive-host-backup-schedule-v1",
		Source:     "installer_crontab",
		State:      "registered",
		Expression: "17 3 * * *",
	}
	writeBackupTestJSON(t, dir, "backup-admin-inventory.json", page.Inventory)
	for _, preset := range []string{"daily", "weekly", "disabled"} {
		body := fmt.Sprintf(`{"action":"schedule","preset":%q,"revision":%q,"confirmation":%q}`,
			preset, testPolicyRevision, "SCHEDULE "+preset)
		code, message := runBackupAdminAction(t, server, body)
		if code != http.StatusAccepted {
			t.Fatalf("safe schedule %s rejected: %d %s", preset, code, message)
		}
		var accepted backupAdminRequest
		if err := readSafeBackupAdminJSON(dir, "backup-admin-request.json", 2048, &accepted); err != nil {
			t.Fatal(err)
		}
		if accepted.Action != "schedule" || accepted.Preset != preset ||
			accepted.Revision != testPolicyRevision || accepted.Confirmation != "SCHEDULE "+preset {
			t.Fatalf("Host request was rewritten: %+v", accepted)
		}
		if err := os.Remove(filepath.Join(dir, "backup-admin-request.json")); err != nil {
			t.Fatal(err)
		}
	}
	for _, body := range []string{
		fmt.Sprintf(`{"action":"schedule","preset":"daily","revision":%q,"confirmation":"SCHEDULE weekly"}`, testPolicyRevision),
		fmt.Sprintf(`{"action":"schedule","preset":"daily","revision":%q,"confirmation":"SCHEDULE daily","command":"id"}`, testPolicyRevision),
		fmt.Sprintf(`{"action":"schedule","preset":"daily","revision":%q,"confirmation":"SCHEDULE daily","repository_dir":"/etc"}`, testPolicyRevision),
	} {
		code, _ := runBackupAdminAction(t, server, body)
		if code != http.StatusBadRequest {
			t.Fatalf("unsafe schedule request accepted: %d %s", code, body)
		}
	}
	stale := fmt.Sprintf(`{"action":"schedule","preset":"daily","revision":%q,"confirmation":"SCHEDULE daily"}`,
		strings.Repeat("b", 64))
	if code, _ := runBackupAdminAction(t, server, stale); code != http.StatusConflict {
		t.Fatalf("stale schedule revision accepted: %d", code)
	}
	for _, badState := range []string{"mismatch", "unknown"} {
		page.Inventory.Schedule.State = badState
		writeBackupTestJSON(t, dir, "backup-admin-inventory.json", page.Inventory)
		code, _ := runBackupAdminAction(t, server,
			fmt.Sprintf(`{"action":"schedule","preset":"daily","revision":%q,"confirmation":"SCHEDULE daily"}`, testPolicyRevision))
		if code != http.StatusConflict {
			t.Fatalf("unsafe Host state %s authorized schedule: %d", badState, code)
		}
	}
	if err := os.Remove(filepath.Join(dir, "backup-admin-inventory.json")); err != nil {
		t.Fatal(err)
	}
	code, _ := runBackupAdminAction(t, server,
		fmt.Sprintf(`{"action":"schedule","preset":"disabled","revision":%q,"confirmation":"SCHEDULE disabled"}`, testPolicyRevision))
	if code != http.StatusServiceUnavailable {
		t.Fatalf("unavailable Host admitted schedule control: %d", code)
	}
	if _, err := os.Stat(filepath.Join(dir, "backup-admin-request.json")); !os.IsNotExist(err) {
		t.Fatalf("rejected schedule wrote Host operation: %v", err)
	}
}
