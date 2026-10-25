package main

import (
	"strings"

	"github.com/lazyxu/xdrive/internal/maintenance"
)

// storageVerifySummary intentionally excludes shared CAS references and
// regenerable cache bookkeeping. Those can be enormous and do not make a
// strict verification fail. The complete report remains available via --json.
type storageVerifySummary struct {
	OK               bool                                   `json:"ok"`
	Mode             maintenance.VerifyMode                 `json:"verification_mode"`
	HashedFiles      int                                    `json:"hashed_files"`
	HashedBytes      int64                                  `json:"hashed_bytes"`
	ElapsedMillis    int64                                  `json:"elapsed_ms"`
	Counts           storageVerifyCounts                    `json:"counts"`
	MissingReasons   map[string]int                         `json:"missing_reasons"`
	MissingSamples   []maintenance.MissingBlob              `json:"missing_samples"`
	SizeSamples      []maintenance.SizeMismatch             `json:"size_samples"`
	DuplicateSamples []maintenance.DuplicateReference       `json:"duplicate_samples"`
	ContentSamples   []maintenance.ContentReferenceMismatch `json:"content_samples"`
	OrphanSamples    []maintenance.OrphanBlob               `json:"orphan_samples"`
	HashSamples      []maintenance.HashMismatch             `json:"hash_samples"`
}

type storageVerifyCounts struct {
	Missing                    int `json:"missing"`
	SizeMismatches             int `json:"size_mismatches"`
	DuplicateReferences        int `json:"duplicate_references"`
	ContentReferenceMismatches int `json:"content_reference_mismatches"`
	Orphans                    int `json:"orphans"`
	HashMismatches             int `json:"hash_mismatches"`
}

func summarizeStorageVerify(r maintenance.VerifyReport) storageVerifySummary {
	s := storageVerifySummary{
		OK:            r.OK(),
		Mode:          r.Mode,
		HashedFiles:   r.HashedFiles,
		HashedBytes:   r.HashedBytes,
		ElapsedMillis: r.ElapsedMillis,
		Counts: storageVerifyCounts{
			Missing:                    len(r.Missing),
			SizeMismatches:             len(r.SizeMismatches),
			DuplicateReferences:        len(r.DuplicateRefs),
			ContentReferenceMismatches: len(r.ContentRefMismatch),
			Orphans:                    len(r.Orphans),
			HashMismatches:             len(r.HashMismatches),
		},
		MissingReasons: make(map[string]int),
	}
	for _, m := range r.Missing {
		reason := m.Reason
		switch {
		case strings.Contains(strings.ToLower(reason), "permission denied"):
			reason = "permission_denied"
		case reason == "not_found":
			reason = "not_found"
		case reason == "not_regular_file":
			reason = "not_regular_file"
		case reason == "invalid_storage_key":
			reason = "invalid_storage_key"
		default:
			reason = "other"
		}
		s.MissingReasons[reason]++
	}
	const sampleLimit = 5
	if len(r.Missing) > 0 {
		s.MissingSamples = r.Missing[:min(sampleLimit, len(r.Missing))]
	}
	if len(r.SizeMismatches) > 0 {
		s.SizeSamples = r.SizeMismatches[:min(sampleLimit, len(r.SizeMismatches))]
	}
	if len(r.DuplicateRefs) > 0 {
		s.DuplicateSamples = r.DuplicateRefs[:min(sampleLimit, len(r.DuplicateRefs))]
	}
	if len(r.ContentRefMismatch) > 0 {
		s.ContentSamples = r.ContentRefMismatch[:min(sampleLimit, len(r.ContentRefMismatch))]
	}
	if len(r.Orphans) > 0 {
		s.OrphanSamples = r.Orphans[:min(sampleLimit, len(r.Orphans))]
	}
	if len(r.HashMismatches) > 0 {
		s.HashSamples = r.HashMismatches[:min(sampleLimit, len(r.HashMismatches))]
	}
	return s
}
