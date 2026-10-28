package api

import (
	"strings"
	"time"
)

// Evidence comes only from a completed Host-controlled, RAM-only Docker
// execution. A historical receipt is not current backup integrity nor
// production destructive-restore acceptance.
type backupAdminDrillReceipt struct {
	Protocol           string `json:"protocol"`
	State              string `json:"state"`
	Environment        string `json:"environment"`
	Snapshot           string `json:"snapshot"`
	StartedAt          string `json:"started_at"`
	FinishedAt         string `json:"finished_at"`
	FilesRestored      bool   `json:"files_restored"`
	PostgreSQLRestored bool   `json:"postgresql_restored"`
	ProductionVerified bool   `json:"production_verified"`
	MaxMiB             int    `json:"max_mib"`
	FailureCategory    string `json:"failure_category"`
}

func validBackupDrillReceipt(e backupAdminHistoryEntry) bool {
	d := e.Drill
	if d == nil {
		return e.Action != "drill" || e.State == "failed"
	}
	if e.Action != "drill" ||
		!strings.HasPrefix(e.SnapshotID, "v2-") ||
		d.Protocol != "xdrive-host-isolated-drill-v1" ||
		d.Environment != "host_ephemeral_offline_tmpfs" ||
		d.Snapshot != strings.SplitN(e.SnapshotID, ":", 2)[1] ||
		d.ProductionVerified || d.MaxMiB != 1024 ||
		(d.State != "success" && d.State != "failed") ||
		d.State != e.State {
		return false
	}
	start, e1 := time.Parse(time.RFC3339, d.StartedAt)
	end, e2 := time.Parse(time.RFC3339, d.FinishedAt)
	if e1 != nil || e2 != nil || end.Before(start) || time.Until(end) > 15*time.Second {
		return false
	}
	switch d.State {
	case "success":
		return d.FilesRestored && d.PostgreSQLRestored && d.FailureCategory == ""
	case "failed":
		switch d.FailureCategory {
		case "unsafe_snapshot", "invalid_snapshot_checksum",
			"sandbox_quota_exceeded", "runtime_unavailable",
			"file_restore_failed", "postgresql_restore_failed",
			"repository_busy", "drill_failed":
			return !d.PostgreSQLRestored
		}
	}
	return false
}
