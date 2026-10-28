package api

import (
	"strings"
	"time"
)

// A Host-reported, bounded historical read-only result. This does not attest
// a production restore or the snapshot's present-day data integrity.
type backupAdminVerifyAllFailure struct {
	SnapshotID string `json:"snapshot_id"`
	Category   string `json:"category"`
}

type backupAdminVerifyAllReport struct {
	Protocol                string                        `json:"protocol"`
	RequestID               string                        `json:"request_id"`
	Mode                    string                        `json:"mode"`
	State                   string                        `json:"state"`
	StartedAt               string                        `json:"started_at"`
	FinishedAt              string                        `json:"finished_at"`
	TotalSnapshots          int                           `json:"total_snapshots"`
	CheckedSnapshots        int                           `json:"checked_snapshots"`
	PassedSnapshots         int                           `json:"passed_snapshots"`
	FailedSnapshots         int                           `json:"failed_snapshots"`
	UnverifiedSnapshots     int                           `json:"unverified_snapshots"`
	DeepRepositoriesChecked int                           `json:"deep_repositories_checked"`
	DeepRepositoriesFailed  int                           `json:"deep_repositories_failed"`
	FailureSample           []backupAdminVerifyAllFailure `json:"failure_sample"`
	FailureSampleTruncated  bool                          `json:"failure_sample_truncated"`
	FailureCategory         string                        `json:"failure_category"`
}

func validBackupAdminVerifyAllReport(p backupAdminVerifyAllReport) bool {
	if p.Protocol != "xdrive-host-verify-all-v1" || len(p.RequestID) != 24 ||
		strings.Trim(p.RequestID, "0123456789abcdef") != "" ||
		(p.Mode != "fast" && p.Mode != "deep") ||
		(p.State != "success" && p.State != "failed") ||
		p.TotalSnapshots < 0 || p.TotalSnapshots > 1000 ||
		p.CheckedSnapshots < 0 || p.CheckedSnapshots > p.TotalSnapshots ||
		p.PassedSnapshots < 0 || p.FailedSnapshots < 0 ||
		p.PassedSnapshots > p.CheckedSnapshots ||
		p.FailedSnapshots > p.CheckedSnapshots ||
		p.PassedSnapshots+p.FailedSnapshots != p.CheckedSnapshots ||
		p.UnverifiedSnapshots != p.TotalSnapshots-p.CheckedSnapshots ||
		p.DeepRepositoriesChecked < 0 || p.DeepRepositoriesChecked > 2 ||
		p.DeepRepositoriesFailed < 0 || p.DeepRepositoriesFailed > p.DeepRepositoriesChecked ||
		(p.Mode == "fast" && p.DeepRepositoriesChecked != 0) ||
		len(p.FailureSample) > 20 || len(p.FailureSample) > p.FailedSnapshots ||
		p.FailureSampleTruncated != (p.FailedSnapshots > len(p.FailureSample)) {
		return false
	}
	start, e1 := time.Parse(time.RFC3339, p.StartedAt)
	finish, e2 := time.Parse(time.RFC3339, p.FinishedAt)
	if e1 != nil || e2 != nil || finish.Before(start) || time.Until(finish) > 15*time.Second {
		return false
	}
	switch p.FailureCategory {
	case "", "unsafe_repository", "unsafe_snapshot", "snapshot_limit_exceeded",
		"no_snapshots", "incomplete_run":
	default:
		return false
	}
	seen := make(map[string]bool, len(p.FailureSample))
	for _, f := range p.FailureSample {
		if !backupAdminSnapshotID.MatchString(f.SnapshotID) || seen[f.SnapshotID] {
			return false
		}
		seen[f.SnapshotID] = true
		switch f.Category {
		case "missing_object", "object_sha256_mismatch", "object_size_mismatch",
			"unsafe_repository", "unsafe_snapshot", "unsafe_object_bucket",
			"unreadable_or_unsafe_object", "object_read_failed", "measurement_overflow",
			"invalid_object_index", "invalid_legacy_archive", "snapshot_outside_repository",
			"invalid_cas_report", "snapshot_verification_failed":
		default:
			return false
		}
	}
	if p.State == "success" {
		return p.TotalSnapshots > 0 && p.CheckedSnapshots == p.TotalSnapshots &&
			p.FailedSnapshots == 0 && p.DeepRepositoriesFailed == 0 &&
			p.FailureCategory == ""
	}
	return p.FailedSnapshots > 0 || p.DeepRepositoriesFailed > 0 ||
		p.FailureCategory != "" || p.UnverifiedSnapshots > 0
}
