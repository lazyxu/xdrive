package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/lazyxu/xdrive/internal/maintenance"
	"github.com/lazyxu/xdrive/internal/meta"
)

const (
	storageVerifyEvidenceProtocol = "xdrive-storage-integrity-evidence-v1"
	storageVerifyEvidenceMaxBytes = 2048
	storageVerifyEvidenceMaxCount = int64(9007199254740991)
)

// Deliberately excludes every private path, storage key, node ID, original
// SHA-256 and user identifier from the durable administrator-visible report.
type storageVerifyEvidence struct {
	Protocol            string `json:"protocol"`
	Mode                string `json:"mode"`
	ReferencedFiles     int64  `json:"referenced_files"`
	ReferencedVersions  int64  `json:"referenced_versions"`
	PhysicalObjects     int64  `json:"physical_objects"`
	UniqueReferenceKeys int64  `json:"unique_reference_keys"`
	HashedObjects       int64  `json:"hashed_objects"`
	HashedBytes         int64  `json:"hashed_bytes"`
	MissingObjects      int64  `json:"missing_objects"`
	SizeMismatches      int64  `json:"size_mismatches"`
	DuplicateReferences int64  `json:"duplicate_references"`
	ReferenceDrifts     int64  `json:"reference_drifts"`
	OrphanObjects       int64  `json:"orphan_objects"`
	HashMismatches      int64  `json:"hash_mismatches"`
	IssueCount          int64  `json:"issue_count"`
}

func storageVerifyEvidenceFromReport(
	mode maintenance.VerifyMode,
	report maintenance.VerifyReport,
) (storageVerifyEvidence, error) {
	v := storageVerifyEvidence{
		Protocol:            storageVerifyEvidenceProtocol,
		Mode:                string(report.Mode),
		ReferencedFiles:     int64(report.ReferencedFiles),
		ReferencedVersions:  int64(report.ReferencedVersions),
		PhysicalObjects:     int64(report.BlobFiles),
		UniqueReferenceKeys: int64(report.UniqueKeys),
		HashedObjects:       int64(report.HashedFiles),
		HashedBytes:         report.HashedBytes,
		MissingObjects:      int64(len(report.Missing)),
		SizeMismatches:      int64(len(report.SizeMismatches)),
		DuplicateReferences: int64(len(report.DuplicateRefs)),
		ReferenceDrifts:     int64(len(report.ContentRefMismatch)),
		OrphanObjects:       int64(len(report.Orphans)),
		HashMismatches:      int64(len(report.HashMismatches)),
	}
	v.IssueCount = v.MissingObjects + v.SizeMismatches + v.DuplicateReferences +
		v.ReferenceDrifts + v.OrphanObjects + v.HashMismatches
	if report.Mode != mode || !validStorageVerifyEvidence(v) {
		return storageVerifyEvidence{}, errors.New("storage integrity evidence lacks truthful mode or counts")
	}
	return v, nil
}

func validStorageVerifyEvidence(v storageVerifyEvidence) bool {
	if v.Protocol != storageVerifyEvidenceProtocol ||
		(v.Mode != string(maintenance.VerifyModeFast) && v.Mode != string(maintenance.VerifyModeDeep)) {
		return false
	}
	for _, n := range []int64{
		v.ReferencedFiles, v.ReferencedVersions, v.PhysicalObjects,
		v.UniqueReferenceKeys, v.HashedObjects, v.HashedBytes,
		v.MissingObjects, v.SizeMismatches, v.DuplicateReferences,
		v.ReferenceDrifts, v.OrphanObjects, v.HashMismatches, v.IssueCount,
	} {
		if n < 0 || n > storageVerifyEvidenceMaxCount {
			return false
		}
	}
	if v.Mode == string(maintenance.VerifyModeFast) &&
		(v.HashedObjects != 0 || v.HashedBytes != 0 || v.HashMismatches != 0) {
		return false
	}
	// No subtraction, so each component stays within the JS exact integer
	// range; sums exceeding that range must fail before serialization.
	parts := []int64{
		v.MissingObjects, v.SizeMismatches, v.DuplicateReferences,
		v.ReferenceDrifts, v.OrphanObjects, v.HashMismatches,
	}
	var sum int64
	for _, count := range parts {
		sum += count
	}
	return sum <= storageVerifyEvidenceMaxCount && v.IssueCount == sum
}

func parseStorageVerifyEvidence(raw string) *storageVerifyEvidence {
	if len(raw) == 0 || len(raw) > storageVerifyEvidenceMaxBytes {
		return nil
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	var v storageVerifyEvidence
	if decoder.Decode(&v) != nil || decoder.Decode(new(any)) != io.EOF ||
		!validStorageVerifyEvidence(v) {
		return nil
	}
	return &v
}

func (s *Server) persistStorageVerifyEvidence(
	ctx context.Context, runID uint64, mode maintenance.VerifyMode,
	report maintenance.VerifyReport,
) error {
	if s == nil || s.DB == nil || runID == 0 {
		return errors.New("storage verification persistence unavailable")
	}
	v, err := storageVerifyEvidenceFromReport(mode, report)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(v)
	if err != nil || len(raw) > storageVerifyEvidenceMaxBytes {
		return errors.New("storage integrity evidence exceeds bounded schema")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	expectedKind := meta.SystemMaintenanceKindStorageVerify
	if mode == maintenance.VerifyModeFast {
		expectedKind = meta.SystemMaintenanceKindStorageVerifyFast
	}
	result := s.DB.WithContext(ctx).Model(&meta.SystemMaintenanceRun{}).
		Where("id = ? AND kind = ? AND status = ?", runID, expectedKind,
			meta.SystemMaintenanceStatusRunning).
		Update("report_json", string(raw))
	if result.Error != nil {
		return fmt.Errorf("persist storage integrity evidence: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return errors.New("storage integrity run is no longer active")
	}
	return nil
}
