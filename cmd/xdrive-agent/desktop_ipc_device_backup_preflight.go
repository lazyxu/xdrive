package main

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

// The UI receives ONLY private aggregate statistics, never native evidence
// IDs, local paths, device credentials, journal digests or CAS object keys.
// This is not a SourceItem commit, upload or Mirror deletion capability.
type desktopLocalEvidencePreflightDTO struct {
	SourceID              uint64 `json:"source_id"`
	Revision              uint64 `json:"revision"`
	Checked               int    `json:"checked"`
	LocallyHashedFiles    int    `json:"locally_hashed_files"`
	LocallyHashedBytes    int64  `json:"locally_hashed_bytes"`
	MetadataMatchedFiles  int    `json:"metadata_matched_files"`
	PhysicalObservedFiles int    `json:"physical_observed_files"`
	PhysicalObservedBytes int64  `json:"physical_observed_bytes"`
	PhysicalUnobserved    int    `json:"physical_unobserved_files"`
	PhysicalBatchRequests int    `json:"physical_batch_requests"`
	HasMore               bool   `json:"has_more"`
	NextAfterID           uint64 `json:"next_after_id"`
	ServerConsistent      bool   `json:"server_consistent"`
	ContentVerified       bool   `json:"content_verified"`
	CommitSupported       bool   `json:"commit_supported"`
	Authoritative         bool   `json:"authoritative"`
	MissingInferenceSafe  bool   `json:"missing_inference_safe"`
}

type desktopIPCLocalEvidencePreflightManager interface {
	preflightLocalBoundBackupEvidencePage(context.Context, uint64, uint64) (localEvidencePreflightSummary, error)
}

const desktopEvidenceMaxSafeID = uint64(1<<53 - 1)

func desktopLocalEvidencePreflightProjection(
	sourceID, afterID uint64, result localEvidencePreflightSummary,
) (desktopLocalEvidencePreflightDTO, error) {
	var empty desktopLocalEvidencePreflightDTO
	if sourceID == 0 || sourceID > desktopEvidenceMaxSafeID ||
		result.SourceID != sourceID || result.Revision == 0 ||
		result.Revision > desktopEvidenceMaxSafeID ||
		result.Checked < 0 || result.Checked > 64 ||
		result.LocallyHashedFiles != result.Checked ||
		result.MetadataMatchedFiles != result.Checked ||
		result.LocallyHashedBytes < 0 ||
		uint64(result.LocallyHashedBytes) > desktopEvidenceMaxSafeID ||
		result.PhysicalCASObservedFiles < 0 ||
		result.PhysicalCASObservedFiles > 16 ||
		result.PhysicalCASObservedFiles > result.Checked ||
		result.PhysicalCASObservedFiles > 4*result.PhysicalCASBatchRequests ||
		result.PhysicalCASUnobservedFiles != result.Checked-result.PhysicalCASObservedFiles ||
		result.PhysicalCASObservedBytes < 0 ||
		result.PhysicalCASObservedBytes > 256<<20 ||
		result.PhysicalCASBatchRequests < 0 ||
		result.PhysicalCASBatchRequests > 4 ||
		(result.PhysicalCASObservedFiles == 0) != (result.PhysicalCASBatchRequests == 0) ||
		(result.Checked > 0 && (!result.ServerConsistent || !result.CloudMetadataMatched)) ||
		result.CloudContentVerified || result.ContentVerified ||
		result.CommitSupported || result.Authoritative || result.MissingInferenceSafe ||
		(result.Checked > 0 && result.NextAfterID <= afterID) ||
		(result.HasMore && result.Checked == 0) ||
		result.NextAfterID > desktopEvidenceMaxSafeID {
		return empty, errors.New("unsafe or incomplete local content preflight")
	}
	return desktopLocalEvidencePreflightDTO{
		SourceID: sourceID, Revision: result.Revision,
		Checked:               result.Checked,
		LocallyHashedFiles:    result.LocallyHashedFiles,
		LocallyHashedBytes:    result.LocallyHashedBytes,
		MetadataMatchedFiles:  result.MetadataMatchedFiles,
		PhysicalObservedFiles: result.PhysicalCASObservedFiles,
		PhysicalObservedBytes: result.PhysicalCASObservedBytes,
		PhysicalUnobserved:    result.PhysicalCASUnobservedFiles,
		PhysicalBatchRequests: result.PhysicalCASBatchRequests,
		HasMore:               result.HasMore, NextAfterID: result.NextAfterID,
		ServerConsistent: result.ServerConsistent,
		ContentVerified:  false, CommitSupported: false,
		Authoritative: false, MissingInferenceSafe: false,
	}, nil
}

func (h *desktopIPCHandler) localBoundBackupEvidencePreflight(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	sourceValues, sourceOK := query["source_id"]
	afterValues, hasAfter := query["after_evidence_id"]
	expectedQueryKeys := 1
	if hasAfter {
		expectedQueryKeys = 2
	}
	if r.ContentLength != 0 || !sourceOK || len(sourceValues) != 1 ||
		(hasAfter && len(afterValues) != 1) || len(query) != expectedQueryKeys {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_content_preflight_request", "source_id and optional after_evidence_id only")
		return
	}
	sourceID, err := strconv.ParseUint(strings.TrimSpace(sourceValues[0]), 10, 64)
	if err != nil || sourceID == 0 || sourceID > desktopEvidenceMaxSafeID {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_content_preflight_source", "valid Source ID required")
		return
	}
	var afterID uint64
	if hasAfter {
		afterID, err = strconv.ParseUint(strings.TrimSpace(afterValues[0]), 10, 64)
		if err != nil || afterID > desktopEvidenceMaxSafeID {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_content_preflight_cursor", "invalid evidence cursor")
			return
		}
	}
	manager, ok := h.ctrl.(desktopIPCLocalEvidencePreflightManager)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_content_preflight_unavailable", "owning Agent preflight unavailable")
		return
	}
	summary, err := manager.preflightLocalBoundBackupEvidencePage(r.Context(), sourceID, afterID)
	if err != nil {
		// Existing safe controller error path must never disclose a native
		// path, CAS digest, device credential or remote HTTP body.
		writeDesktopIPCControllerError(w, err)
		return
	}
	out, err := desktopLocalEvidencePreflightProjection(sourceID, afterID, summary)
	if err != nil {
		writeDesktopIPCError(w, http.StatusConflict, "local_content_preflight_stale", "local content preflight needs verification")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, out)
}
