package main

import (
	"context"
	"crypto/hmac"
	"encoding/hex"
	"net/http"
	"net/url"
	"runtime"
	"strconv"
)

const localCommonRecoveryReviewPageSize = 16
const localCommonRecoveryReviewMaxAfter = 1000000

// Historical inventory counts only: intentionally no path, session,
// Device token, Root fingerprint, Operation ID, receipt or CAS claim.
// This DTO compiles on unsupported platforms, where the handler returns 501.
type localCommonRecoveryReviewPage struct {
	SourceID            uint64 `json:"source_id"`
	Revision            uint64 `json:"revision"`
	RunState            string `json:"run_state"`
	ReviewedFiles       uint64 `json:"reviewed_files"`
	IgnoredFiles        uint64 `json:"ignored_files"`
	UnsupportedFiles    uint64 `json:"unsupported_files"`
	UnrecordedFiles     uint64 `json:"unrecorded_files"`
	HistoricalCommitted uint64 `json:"historical_committed_files"`
	CurrentNodeMatch    uint64 `json:"current_node_metadata_match_files"`
	CurrentNodeMismatch uint64 `json:"current_node_metadata_mismatch_files"`
	PendingFiles        uint64 `json:"pending_original_files"`
	NextAfterFile       uint64 `json:"next_after_file"`
	PageEpoch           string `json:"page_epoch"`
	HasMore             bool   `json:"has_more"`
	Authoritative       bool   `json:"authoritative"`
}

type desktopIPCLocalCommonRecoveryReviewer interface {
	CloudLocalBoundBackupCommonRecoveryReview(context.Context, uint64, uint64, string) (localCommonRecoveryReviewPage, error)
}

// Only bounded Source ID + file ordinal are accepted from owning Desktop.
// Never accept file paths, private plan identities, tokens or SQL selectors.
// After the first page, a private Owner-scoped opaque epoch is mandatory.
// It is NOT a credential, raw snapshot SHA or permission to write anything.
func validLocalCommonRecoveryReviewRequest(r *http.Request) (uint64, uint64, string, bool) {
	if r == nil || r.Method != http.MethodGet || r.ContentLength != 0 {
		return 0, 0, "", false
	}
	q, parseErr := url.ParseQuery(r.URL.RawQuery)
	if parseErr != nil || len(q) < 1 || len(q) > 3 || len(q["source_id"]) != 1 {
		return 0, 0, "", false
	}
	for name := range q {
		if name != "source_id" && name != "after_file" &&
			name != "page_epoch" {
			return 0, 0, "", false
		}
	}
	sourceText := q.Get("source_id")
	sourceID, err := strconv.ParseUint(sourceText, 10, 64)
	if err != nil || sourceID == 0 || sourceID > desktopEvidenceMaxSafeID ||
		strconv.FormatUint(sourceID, 10) != sourceText {
		return 0, 0, "", false
	}
	var after uint64
	if values, exists := q["after_file"]; exists {
		if len(values) != 1 {
			return 0, 0, "", false
		}
		after, err = strconv.ParseUint(values[0], 10, 64)
		if err != nil || after > localCommonRecoveryReviewMaxAfter ||
			strconv.FormatUint(after, 10) != values[0] {
			return 0, 0, "", false
		}
	}
	var epoch string
	if values, exists := q["page_epoch"]; exists {
		if len(values) != 1 {
			return 0, 0, "", false
		}
		epoch = values[0]
	}
	_, hasEpoch := q["page_epoch"]
	if (after == 0 && hasEpoch) ||
		(after != 0 && !validLocalCommonRecoveryEpoch(epoch)) {
		return 0, 0, "", false
	}
	return sourceID, after, epoch, true
}

func validLocalCommonRecoveryEpoch(epoch string) bool {
	if len(epoch) != 64 {
		return false
	}
	decoded, err := hex.DecodeString(epoch)
	return err == nil && len(decoded) == 32 &&
		hex.EncodeToString(decoded) == epoch
}

// Defense in depth: the Handler refuses to serialize a forged controller
// page, including a stale/foreign generation, private full-source success,
// malformed page counts, or out-of-range continuation selectors.
func validLocalCommonRecoveryReviewPage(
	page localCommonRecoveryReviewPage, sourceID, after uint64, requestedEpoch string,
) bool {
	if page.SourceID != sourceID || page.Revision == 0 ||
		page.Authoritative || !validLocalCommonRecoveryEpoch(page.PageEpoch) ||
		(after != 0 && !hmac.Equal([]byte(requestedEpoch), []byte(page.PageEpoch))) ||
		page.ReviewedFiles > localCommonRecoveryReviewPageSize ||
		page.ReviewedFiles != page.IgnoredFiles+page.UnsupportedFiles+
			page.UnrecordedFiles+page.HistoricalCommitted+page.PendingFiles ||
		page.HistoricalCommitted != page.CurrentNodeMatch+page.CurrentNodeMismatch ||
		(page.RunState != "partial" && page.RunState != "uncertain" &&
			page.RunState != "paused" && page.RunState != "cancelled") ||
		(page.HasMore && (page.ReviewedFiles != localCommonRecoveryReviewPageSize ||
			page.NextAfterFile != after+page.ReviewedFiles)) ||
		(!page.HasMore && page.NextAfterFile != 0) ||
		page.NextAfterFile > localCommonRecoveryReviewMaxAfter {
		return false
	}
	return true
}

func (h *desktopIPCHandler) localBoundBackupCommonRecoveryReview(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		writeDesktopIPCError(w, http.StatusNotImplemented,
			"local_common_recovery_platform_unavailable", "local recovery review unavailable")
		return
	}
	sourceID, after, epoch, ok := validLocalCommonRecoveryReviewRequest(r)
	if !ok {
		writeDesktopIPCError(w, http.StatusBadRequest,
			"invalid_local_common_recovery_review", "source_id, numeric after_file and private page_epoch only")
		return
	}
	reader, ok := h.ctrl.(desktopIPCLocalCommonRecoveryReviewer)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented,
			"local_common_recovery_unavailable", "owning Agent unavailable")
		return
	}
	page, err := reader.CloudLocalBoundBackupCommonRecoveryReview(r.Context(), sourceID, after, epoch)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if !validLocalCommonRecoveryReviewPage(page, sourceID, after, epoch) {
		writeDesktopIPCError(w, http.StatusConflict,
			"local_common_recovery_unverified", "local recovery review unavailable")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, page)
}
