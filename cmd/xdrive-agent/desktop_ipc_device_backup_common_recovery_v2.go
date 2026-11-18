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
	AbsentReviewed      uint64 `json:"absent_receipts_reviewed"`
	AbsentCommitted     uint64 `json:"absent_receipts_committed"`
	AbsentPending       uint64 `json:"absent_receipts_pending"`
	AbsentHasMore       bool   `json:"absent_receipts_has_more"`
	NextAfterAbsent     uint64 `json:"next_after_absent"`
	AbsentPaths         uint64 `json:"absent_original_paths"`
	JournalChecked      bool   `json:"journal_checked"`
	NextAfterFile       uint64 `json:"next_after_file"`
	PageEpoch           string `json:"page_epoch"`
	HasMore             bool   `json:"has_more"`
	Authoritative       bool   `json:"authoritative"`
}

type desktopIPCLocalCommonRecoveryReviewer interface {
	CloudLocalBoundBackupCommonRecoveryReview(context.Context, uint64, uint64, string, uint64) (localCommonRecoveryReviewPage, error)
}

// Only bounded Source ID + file ordinal are accepted from owning Desktop.
// Never accept file paths, private plan identities, tokens or SQL selectors.
// After the first page, a private Owner-scoped opaque epoch is mandatory.
// It is NOT a credential, raw snapshot SHA or permission to write anything.
// Backwards-compatible selector used by existing owner-only Agent IPC tests.
func validLocalCommonRecoveryReviewRequest(r *http.Request) (uint64, uint64, string, bool) {
	source, afterFile, _, epoch, ok := validLocalCommonRecoveryReviewRequestWithAbsent(r)
	return source, afterFile, epoch, ok
}

func validLocalCommonRecoveryReviewRequestWithAbsent(r *http.Request) (
	uint64, uint64, uint64, string, bool,
) {
	if r == nil || r.Method != http.MethodGet || r.ContentLength != 0 {
		return 0, 0, 0, "", false
	}
	q, parseErr := url.ParseQuery(r.URL.RawQuery)
	if parseErr != nil || len(q) < 1 || len(q) > 4 || len(q["source_id"]) != 1 {
		return 0, 0, 0, "", false
	}
	for name := range q {
		if name != "source_id" && name != "after_file" &&
			name != "after_absent" && name != "page_epoch" {
			return 0, 0, 0, "", false
		}
	}
	sourceText := q.Get("source_id")
	sourceID, err := strconv.ParseUint(sourceText, 10, 64)
	if err != nil || sourceID == 0 || sourceID > desktopEvidenceMaxSafeID ||
		strconv.FormatUint(sourceID, 10) != sourceText {
		return 0, 0, 0, "", false
	}
	parseOrdinal := func(field string) (uint64, bool) {
		values, exists := q[field]
		if !exists {
			return 0, true
		}
		if len(values) != 1 {
			return 0, false
		}
		value, err := strconv.ParseUint(values[0], 10, 64)
		return value, err == nil && value <= localCommonRecoveryReviewMaxAfter &&
			strconv.FormatUint(value, 10) == values[0]
	}
	afterFile, ok := parseOrdinal("after_file")
	if !ok {
		return 0, 0, 0, "", false
	}
	afterAbsent, ok := parseOrdinal("after_absent")
	if !ok {
		return 0, 0, 0, "", false
	}
	var epoch string
	if values, exists := q["page_epoch"]; exists {
		if len(values) != 1 {
			return 0, 0, 0, "", false
		}
		epoch = values[0]
	}
	_, hasEpoch := q["page_epoch"]
	if ((afterFile == 0 && afterAbsent == 0) && hasEpoch) ||
		((afterFile != 0 || afterAbsent != 0) &&
			!validLocalCommonRecoveryEpoch(epoch)) {
		return 0, 0, 0, "", false
	}
	return sourceID, afterFile, afterAbsent, epoch, true
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
	afterAbsent ...uint64,
) bool {
	var absentAfter uint64
	if len(afterAbsent) > 0 {
		absentAfter = afterAbsent[0]
	}
	if page.SourceID != sourceID || page.Revision == 0 ||
		page.Authoritative || !validLocalCommonRecoveryEpoch(page.PageEpoch) ||
		((after != 0 || absentAfter != 0) &&
			!hmac.Equal([]byte(requestedEpoch), []byte(page.PageEpoch))) ||
		page.ReviewedFiles > localCommonRecoveryReviewPageSize ||
		page.ReviewedFiles != page.IgnoredFiles+page.UnsupportedFiles+
			page.UnrecordedFiles+page.HistoricalCommitted+page.PendingFiles ||
		page.HistoricalCommitted != page.CurrentNodeMatch+page.CurrentNodeMismatch ||
		(page.RunState != "partial" && page.RunState != "uncertain" &&
			page.RunState != "paused" && page.RunState != "cancelled") ||
		(page.HasMore && (page.ReviewedFiles != localCommonRecoveryReviewPageSize ||
			page.NextAfterFile != after+page.ReviewedFiles)) ||
		(!page.HasMore && page.NextAfterFile != 0) ||
		page.NextAfterFile > localCommonRecoveryReviewMaxAfter ||
		page.AbsentPaths > localCommonRecoveryReviewMaxAfter ||
		(!page.JournalChecked && (page.AbsentPaths != 0 ||
			page.AbsentReviewed != 0 || page.AbsentCommitted != 0 ||
			page.AbsentPending != 0 || page.AbsentHasMore || page.NextAfterAbsent != 0)) ||
		(page.JournalChecked && (page.AbsentReviewed > localCommonRecoveryReviewPageSize ||
			page.AbsentReviewed != page.AbsentCommitted+page.AbsentPending ||
			page.AbsentReviewed+absentAfter > page.AbsentPaths ||
			(page.AbsentHasMore && (page.AbsentReviewed != localCommonRecoveryReviewPageSize ||
				page.NextAfterAbsent != absentAfter+page.AbsentReviewed ||
				page.NextAfterAbsent >= page.AbsentPaths)) ||
			(!page.AbsentHasMore && (page.NextAfterAbsent != 0 ||
				page.AbsentReviewed+absentAfter != page.AbsentPaths)))) {
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
	sourceID, after, afterAbsent, epoch, ok := validLocalCommonRecoveryReviewRequestWithAbsent(r)
	if !ok {
		writeDesktopIPCError(w, http.StatusBadRequest,
			"invalid_local_common_recovery_review", "source_id, numeric after_file/after_absent and private page_epoch only")
		return
	}
	reader, ok := h.ctrl.(desktopIPCLocalCommonRecoveryReviewer)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented,
			"local_common_recovery_unavailable", "owning Agent unavailable")
		return
	}
	page, err := reader.CloudLocalBoundBackupCommonRecoveryReview(r.Context(), sourceID, after, epoch, afterAbsent)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if !validLocalCommonRecoveryReviewPage(page, sourceID, after, epoch, afterAbsent) {
		writeDesktopIPCError(w, http.StatusConflict,
			"local_common_recovery_unverified", "local recovery review unavailable")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, page)
}
