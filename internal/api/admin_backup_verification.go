package api

import "strings"

// A fixed-schema Host receipt. Never include raw paths, object hashes or logs.
type backupAdminVerificationReceipt struct {
	Protocol          string ${tick}json:"protocol"${tick}
	State             string ${tick}json:"state"${tick}
	Format            string ${tick}json:"format"${tick}
	Scope             string ${tick}json:"scope"${tick}
	CASObjectsChecked int64  ${tick}json:"cas_objects_checked"${tick}
	CASBytesHashed    int64  ${tick}json:"cas_bytes_hashed"${tick}
	FailureCategory   string ${tick}json:"failure_category,omitempty"${tick}
}

func validBackupVerificationReceipt(e backupAdminHistoryEntry) bool {
	v := e.Verification
	if v == nil {
		return true // Old Host histories remain compatible.
	}
	if e.Action != "verify" || v.Protocol != "xdrive-host-backup-verify-v1" ||
		(v.State != "success" && v.State != "failed") ||
		v.Scope != "backup_snapshot_and_referenced_cas" ||
		(e.State == "success" && v.State != "success") ||
		v.CASObjectsChecked < 0 || v.CASBytesHashed < 0 ||
		v.CASObjectsChecked > 9007199254740991 || v.CASBytesHashed > 9007199254740991 {
		return false
	}
	expected := "v2"
	if strings.HasPrefix(e.SnapshotID, "v1:") {
		expected = "v1"
	}
	if v.Format != expected || (v.Format == "v1" &&
		(v.CASObjectsChecked != 0 || v.CASBytesHashed != 0)) {
		return false
	}
	switch v.FailureCategory {
	case "":
		return v.State == "success"
	case "missing_object", "object_sha256_mismatch", "object_size_mismatch",
		"unsafe_repository", "unsafe_snapshot", "unsafe_object_bucket",
		"unreadable_or_unsafe_object", "object_read_failed", "measurement_overflow",
		"invalid_object_index", "invalid_legacy_archive", "snapshot_outside_repository",
		"invalid_cas_report", "snapshot_verification_failed":
		return v.State == "failed"
	default:
		return false
	}
}
