package api

import "strings"

// Host-generated, bounded read-only evidence for exactly one selected v2
// generation. This report is never a deletion permit; the future destructive
// operation must independently re-audit under the repository exclusive lock.
type backupAdminSelectedPreview struct {
	Protocol   string                         `json:"protocol"`
	RequestID  string                         `json:"request_id"`
	SnapshotID string                         `json:"snapshot_id"`
	Mode       string                         `json:"mode"`
	Report     backupAdminSelectedPreviewPlan `json:"report"`
}

type backupAdminSelectedPreviewPlan struct {
	Protocol              string `json:"protocol"`
	Mode                  string `json:"mode"`
	Validation            string `json:"validation"`
	Snapshot              string `json:"snapshot"`
	CommittedSnapshots    int    `json:"committed_snapshots"`
	SurvivingSnapshots    int    `json:"surviving_snapshots"`
	SelectedSnapshotBytes int64  `json:"selected_snapshot_bytes"`
	SelectedCASObjects    int    `json:"selected_cas_objects"`
	SharedCASObjects      int    `json:"shared_cas_objects"`
	ExclusiveCASObjects   int    `json:"exclusive_cas_objects"`
	ExclusiveCASBytes     int64  `json:"exclusive_cas_bytes"`
	UnreferencedObjects   int    `json:"unreferenced_objects"`
	UnreferencedBytes     int64  `json:"unreferenced_bytes"`
	PotentialLogicalBytes int64  `json:"potential_logical_bytes"`
	HashedObjects         int    `json:"hashed_objects"`
	HashedBytes           int64  `json:"hashed_bytes"`
	DeleteEnabled         bool   `json:"delete_enabled"`
}

func validBackupAdminSelectedPreview(v backupAdminSelectedPreview) bool {
	const maxExact = int64(9007199254740991)
	const maxCount = int(1000000000)
	if v.Protocol != "xdrive-host-selected-v2-preview-v1" ||
		len(v.RequestID) != 24 || strings.Trim(v.RequestID, "0123456789abcdef") != "" ||
		!backupAdminSnapshotID.MatchString(v.SnapshotID) ||
		!strings.HasPrefix(v.SnapshotID, "v2-") ||
		(v.Mode != "fast" && v.Mode != "deep") {
		return false
	}
	p := v.Report
	expectedValidation := "snapshot_sha256_and_cas_size"
	if v.Mode == "deep" {
		expectedValidation = "snapshot_sha256_and_full_cas_sha256"
	}
	if p.Protocol != "xdrive-backup-selected-prune-plan-v1" ||
		p.Mode != "read_only" || p.DeleteEnabled ||
		p.Validation != expectedValidation ||
		p.Snapshot != strings.SplitN(v.SnapshotID, ":", 2)[1] ||
		p.CommittedSnapshots < 2 || p.CommittedSnapshots > 1000 ||
		p.SurvivingSnapshots != p.CommittedSnapshots-1 {
		return false
	}
	for _, n := range []int{p.SelectedCASObjects, p.SharedCASObjects,
		p.ExclusiveCASObjects, p.UnreferencedObjects, p.HashedObjects} {
		if n < 0 || n > maxCount {
			return false
		}
	}
	if p.SharedCASObjects+p.ExclusiveCASObjects != p.SelectedCASObjects {
		return false
	}
	for _, n := range []int64{p.SelectedSnapshotBytes, p.ExclusiveCASBytes,
		p.UnreferencedBytes, p.PotentialLogicalBytes, p.HashedBytes} {
		if n < 0 || n > maxExact {
			return false
		}
	}
	// A deep claim must account for at least the selected and orphan CAS
	// objects. A fake `deep` mode label with zero hashes is not evidence.
	if v.Mode == "deep" &&
		(p.HashedObjects < p.SelectedCASObjects+p.UnreferencedObjects ||
			p.HashedBytes < p.ExclusiveCASBytes+p.UnreferencedBytes) {
		return false
	}
	return p.PotentialLogicalBytes ==
		p.SelectedSnapshotBytes+p.ExclusiveCASBytes+p.UnreferencedBytes
}
