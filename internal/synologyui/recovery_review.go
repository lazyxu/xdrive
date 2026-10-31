package synologyui

import (
	"context"
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

// Optional read-only owning Agent capability; it does not change the Agent
// interface, require full Desktop mode or expose a generic private RPC.
type LocalRecoveryReviewReader interface {
	RecoveryReview(context.Context, uint64, uint64, string) (localbackupipc.RecoveryReviewPage, error)
}

// Only a canonical Source ID, file ordinal and opaque epoch are accepted.
// The actual Source, native Root, account and SQL Operation proof are checked
// again inside the original Agent. DSM never receives a path or receipt token.
func parseDSMRecoveryReview(r *http.Request) (uint64, uint64, string, bool) {
	if r == nil || r.URL == nil || r.Method != http.MethodGet || r.ContentLength != 0 {
		return 0, 0, "", false
	}
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(q) < 1 || len(q) > 3 || len(q["source_id"]) != 1 {
		return 0, 0, "", false
	}
	for key, values := range q {
		if len(values) != 1 || (key != "source_id" && key != "after_file" && key != "page_epoch") {
			return 0, 0, "", false
		}
	}
	sourceID, err := strconv.ParseUint(q.Get("source_id"), 10, 64)
	if err != nil || strconv.FormatUint(sourceID, 10) != q.Get("source_id") {
		return 0, 0, "", false
	}
	var after uint64
	if values, ok := q["after_file"]; ok {
		after, err = strconv.ParseUint(values[0], 10, 64)
		if err != nil || strconv.FormatUint(after, 10) != values[0] {
			return 0, 0, "", false
		}
	}
	epoch := q.Get("page_epoch")
	if (after == 0 && len(q["page_epoch"]) != 0) ||
		!localbackupipc.ValidRecoveryReviewSelector(sourceID, after, epoch) {
		return 0, 0, "", false
	}
	return sourceID, after, epoch, true
}

// All GET operations are authenticated against the DSM user and its allowed
// package-local Agent before this handler runs; no Source writer is invoked.
func serveDSMRecoveryReview(
	w http.ResponseWriter, r *http.Request, ctx context.Context, agent Agent,
) {
	sourceID, after, epoch, ok := parseDSMRecoveryReview(r)
	if !ok {
		http.Error(w, "invalid local recovery review selector", http.StatusBadRequest)
		return
	}
	reader, ok := agent.(LocalRecoveryReviewReader)
	if !ok {
		http.Error(w, "owning Agent historical review unsupported", http.StatusNotImplemented)
		return
	}
	page, err := reader.RecoveryReview(ctx, sourceID, after, epoch)
	if err != nil || !localbackupipc.ValidateRecoveryReviewPage(page, sourceID, after, epoch) {
		http.Error(w, "owning Source historical receipts unavailable", http.StatusServiceUnavailable)
		return
	}
	sendJSON(w, page)
}
