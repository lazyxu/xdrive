package api

import (
	"testing"
	"time"
)

func TestBackupAdminVerificationStrictHostReceipt(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	now := time.Now().UTC()
	e := backupAdminHistoryEntry{backupAdminStatus: backupAdminStatus{
		Protocol: backupAdminProtocol, RequestID: "a123456789abcdef01234567",
		Action: "verify", SnapshotID: testBackupID, State: "success",
		StartedAt: now.Add(-time.Minute).Format(time.RFC3339),
		FinishedAt: now.Format(time.RFC3339),
	}, Mode:"deep"}
	receipt := backupAdminVerificationReceipt{
		Protocol: "xdrive-host-backup-verify-v1", State: "success", Format: "v2",
		Scope:"backup_snapshot_and_referenced_cas",
		CASObjectsChecked: 3, CASBytesHashed: 8192,
	}
	e.Verification = &receipt
	save := func(value backupAdminHistoryEntry) int {
		writeBackupTestJSON(t, dir, "backup-admin-history.json", backupAdminHistory{
			Protocol:"xdrive-backup-admin-history-v1", Operations: []backupAdminHistoryEntry{value},
		})
		return len(server.backupAdminState().History)
	}
	if save(e)!=1 { t.Fatal("Host verified receipt rejected") }
	for _, tc := range []struct{name string; mutate func(*backupAdminVerificationReceipt)}{
		{"wrong_protocol", func(r *backupAdminVerificationReceipt) {r.Protocol="fake"}},
		{"unsafe_negative", func(r *backupAdminVerificationReceipt) {r.CASObjectsChecked=-1}},
		{"unsafe_big", func(r *backupAdminVerificationReceipt) {r.CASBytesHashed=9007199254740992}},
		{"unsafe_category", func(r *backupAdminVerificationReceipt) {r.FailureCategory="/root/password"}},
		{"untrusted_format", func(r *backupAdminVerificationReceipt) {r.Format="v1"}},
		{"false_success", func(r *backupAdminVerificationReceipt) {r.State="failed";r.FailureCategory="missing_object"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			entry:=e; v:=receipt; tc.mutate(&v); entry.Verification=&v
			if save(entry)!=0 {t.Fatal("untrusted Host receipt was accepted")}
		})
	}
	e.Verification=nil
	if save(e)!=1 {t.Fatal("historical receipt without structured proof rejected")}
	failed:=e; failed.State="failed"; failed.ErrorCode="operation_failed"
	v:=receipt; v.State="failed"; v.FailureCategory="object_sha256_mismatch"
	failed.Verification=&v
	if save(failed)!=1 {t.Fatal("genuine failed CAS verification rejected")}
}
