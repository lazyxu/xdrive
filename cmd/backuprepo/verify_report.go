package main

import (
	"archive/tar"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
)

// Only bounded, fixed-schema values are made available to the host/API.
// Raw error strings, filesystem paths and object hashes stay in private
// stderr and must never be put into an Admin response.
type verificationReport struct {
	Protocol        string `json:"protocol"`
	State           string `json:"state"`
	Mode            string `json:"mode"`
	ObjectsChecked  int    `json:"objects_checked"`
	BytesHashed     int64  `json:"bytes_hashed"`
	FailureCategory string `json:"failure_category,omitempty"`
}

func writeVerificationReport(w io.Writer, report verificationReport) error {
	return json.NewEncoder(w).Encode(report)
}

// Preserve legacy verify callers and all fail-closed restore checks.
func verify(repo, snapshot string, full bool) (int, error) {
	result, err := verifyWithReport(repo, snapshot, full)
	return result.ObjectsChecked, err
}

// Before declaring a published v2 restore point usable, enforce the same
// bounded, strictly parsed manifest and exact published-file checksums as
// retention/prune. A raw capture-only in-process test fixture has only
// objects.index and legacy.tar; it is not a published backup and remains
// separately testable without fabricated PostgreSQL contents.
func verifyPublishedSnapshotMetadata(snapshot string) error {
	name := filepath.Base(snapshot)
	published := strings.HasPrefix(name, "xdrive-backup-")
	if published && !canonicalPruneSnapshotName(name) {
		return errors.New("invalid committed v2 snapshot name")
	}
	// A renamed snapshot cannot bypass the published-metadata boundary.
	for _, filename := range []string{"database.dump", "verify.json", "manifest.json", "SHA256SUMS.txt"} {
		if _, err := os.Lstat(filepath.Join(snapshot, filename)); err == nil {
			published = true
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	if !published {
		return nil
	}
	_, err := validateCommittedSnapshot(snapshot)
	return err
}

// A report counts fully verified referenced objects and actual bytes read for
// SHA-256. On failure counts are PARTIAL, never claimed as a complete pass.
// Fast (internal) mode checks sizes only and always reports 0 bytes hashed.
func verifyWithReport(repo, snapshot string, full bool) (verificationReport, error) {
	report := verificationReport{
		Protocol: "xdrive-backup-verify-v1",
		State:    "failed",
		Mode:     "fast",
	}
	if full {
		report.Mode = "deep"
	}
	reject := func(category string, err error) (verificationReport, error) {
		report.FailureCategory = category
		return report, err
	}
	if !strings.HasPrefix(snapshot, filepath.Join(repo, "snapshots")+string(os.PathSeparator)) {
		return reject("snapshot_outside_repository", errors.New("snapshot outside repository"))
	}
	if err := checkRepositoryLayout(repo); err != nil {
		return reject("unsafe_repository", err)
	}
	if err := requireRepositoryDirs(snapshot); err != nil {
		return reject("unsafe_snapshot", err)
	}
	// Check the committed metadata BEFORE reporting any objects as verified.
	// restore() calls this verification before removing destination content.
	if err := verifyPublishedSnapshotMetadata(snapshot); err != nil {
		return reject("unsafe_snapshot", err)
	}
	err := readIndex(snapshot, func(e entry) error {
		if err := checkObjectBucket(repo, e.hash); err != nil {
			report.FailureCategory = "unsafe_object_bucket"
			return err
		}
		st, err := regularFile(objectPath(repo, e.hash))
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				report.FailureCategory = "missing_object"
			} else {
				report.FailureCategory = "unreadable_or_unsafe_object"
			}
			return err
		}
		if st.Size() != e.size {
			report.FailureCategory = "object_size_mismatch"
			return fmt.Errorf("CAS size mismatch %s", e.hash)
		}
		if full {
			f, err := os.Open(objectPath(repo, e.hash))
			if err != nil {
				report.FailureCategory = "object_read_failed"
				return err
			}
			sum := sha256.New()
			n, copyErr := io.Copy(sum, f)
			closeErr := f.Close()
			if n > math.MaxInt64-report.BytesHashed {
				report.FailureCategory = "measurement_overflow"
				return errors.New("verified bytes count overflow")
			}
			report.BytesHashed += n
			if copyErr != nil {
				report.FailureCategory = "object_read_failed"
				return copyErr
			}
			if closeErr != nil {
				report.FailureCategory = "object_read_failed"
				return closeErr
			}
			if n != e.size || hex.EncodeToString(sum.Sum(nil)) != e.hash {
				report.FailureCategory = "object_sha256_mismatch"
				return fmt.Errorf("CAS hash mismatch %s", e.hash)
			}
		}
		report.ObjectsChecked++
		return nil
	})
	if err != nil {
		if report.FailureCategory == "" {
			report.FailureCategory = "invalid_object_index"
		}
		return report, err
	}
	if err := walkLegacyArchive(snapshot, func(_ *tar.Header, _ *tar.Reader) error { return nil }); err != nil {
		return reject("invalid_legacy_archive", err)
	}
	fmt.Fprintf(os.Stderr, "[xDrive] CAS repository verified: %d objects\n", report.ObjectsChecked)
	report.State = "success"
	return report, nil
}
