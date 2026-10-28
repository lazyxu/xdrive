package api

import "strings"

// The Host's source-owned transactional selected-v2 retirement result.
// Only historical evidence. It is not an authorization for another deletion,
// a production restore attestation, or a measurement of disk blocks released.
type backupAdminSelectedDeleteReceipt struct {
	Mode                     string   `json:"mode"`
	KeepLast                 int      `json:"keep_last"`
	RetiredSnapshots         []string `json:"retired_snapshots"`
	RecoveredTransactions    int      `json:"recovered_transactions"`
	DeletedCASObjects        int      `json:"deleted_cas_objects"`
	DeletedCASLogicalBytes   int64    `json:"deleted_cas_logical_bytes"`
	DeletedSnapshotFiles     int      `json:"deleted_snapshot_files"`
	DeletedSnapshotFileBytes int64    `json:"deleted_snapshot_file_bytes"`
	Verification             string   `json:"verification"`
	Automatic                bool     `json:"automatic"`
}

func validBackupSelectedDeleteHistory(e backupAdminHistoryEntry) bool {
	if e.Action != "delete_selected" || e.State != "success" {
		return e.SelectedDelete == nil
	}
	p := e.SelectedDelete
	if p == nil || !backupAdminSnapshotID.MatchString(e.SnapshotID) ||
		!strings.HasPrefix(e.SnapshotID, "v2-") ||
		p.Mode != "manual_selected" || p.Automatic ||
		p.Verification != "exclusive_lock_and_full_cas_sha256" ||
		p.KeepLast < 1 || p.KeepLast > 1000 ||
		len(p.RetiredSnapshots) != 1 ||
		p.RetiredSnapshots[0] != strings.SplitN(e.SnapshotID, ":", 2)[1] {
		return false
	}
	const maxCount = int(1_000_000_000)
	for _, v := range []int{p.RecoveredTransactions, p.DeletedCASObjects, p.DeletedSnapshotFiles} {
		if v < 0 || v > maxCount {
			return false
		}
	}
	const maxExact = int64(9007199254740991)
	for _, v := range []int64{p.DeletedCASLogicalBytes, p.DeletedSnapshotFileBytes} {
		if v < 0 || v > maxExact {
			return false
		}
	}
	return true
}
