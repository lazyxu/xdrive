package localbackupipc

import (
	"context"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strconv"
)

const (
	recoveryReviewPageSize = 16
	recoveryReviewMaxAfter = 1000000
)

// RecoveryReviewPage is an unauthoritative read-only historical SQL receipt
// projection from the original owning Agent. No path, Operation ID, Root,
// device secret or present-day CAS integrity claim may enter this response.
type RecoveryReviewPage struct {
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

func validRecoveryReviewEpoch(epoch string) bool {
	if len(epoch) != 64 {
		return false
	}
	decoded, err := hex.DecodeString(epoch)
	return err == nil && len(decoded) == 32 &&
		hex.EncodeToString(decoded) == epoch
}

func ValidRecoveryReviewSelector(sourceID, afterFile uint64, epoch string) bool {
	return ValidSourceID(sourceID) && afterFile <= recoveryReviewMaxAfter &&
		((afterFile == 0 && epoch == "") ||
			(afterFile != 0 && validRecoveryReviewEpoch(epoch)))
}

// ValidateRecoveryReviewPage refuses stale/foreign generations, numeric
// overflow in browser-visible values, malformed continuations and any claim
// that historical SQL receipts prove current cloud contents or physical CAS.
func ValidateRecoveryReviewPage(
	page RecoveryReviewPage, sourceID, afterFile uint64, epoch string,
) bool {
	if !ValidRecoveryReviewSelector(sourceID, afterFile, epoch) ||
		page.SourceID != sourceID || !ValidSourceID(page.Revision) ||
		page.Authoritative || !validRecoveryReviewEpoch(page.PageEpoch) ||
		(afterFile != 0 && page.PageEpoch != epoch) {
		return false
	}
	switch page.RunState {
	case "partial", "uncertain", "paused", "cancelled":
	default:
		return false
	}
	counts := []uint64{
		page.ReviewedFiles, page.IgnoredFiles, page.UnsupportedFiles,
		page.UnrecordedFiles, page.HistoricalCommitted, page.CurrentNodeMatch,
		page.CurrentNodeMismatch, page.PendingFiles,
	}
	for _, count := range counts {
		if count > recoveryReviewPageSize {
			return false
		}
	}
	if page.IgnoredFiles+page.UnsupportedFiles+page.UnrecordedFiles+
		page.HistoricalCommitted+page.PendingFiles != page.ReviewedFiles ||
		page.CurrentNodeMatch+page.CurrentNodeMismatch != page.HistoricalCommitted {
		return false
	}
	if page.HasMore {
		return page.ReviewedFiles == recoveryReviewPageSize &&
			page.NextAfterFile == afterFile+recoveryReviewPageSize &&
			page.NextAfterFile <= recoveryReviewMaxAfter
	}
	return page.NextAfterFile == 0
}

// RecoveryReview reuses the *already authenticated* same-user Agent IPC.
// Its local Source/Root/session/checkpoint validation and immutable original
// SQL receipt reads remain entirely within the original Agent controller.
func (c *Client) RecoveryReview(
	ctx context.Context, sourceID, afterFile uint64, epoch string,
) (RecoveryReviewPage, error) {
	var empty RecoveryReviewPage
	if c == nil || !hasCapability(c.capabilities, "device-backup-local-common-recovery-review") {
		return empty, errors.New("owning Agent has no local recovery review capability")
	}
	if ctx == nil || ctx.Err() != nil ||
		!ValidRecoveryReviewSelector(sourceID, afterFile, epoch) {
		return empty, errors.New("invalid owning recovery review selector")
	}
	query := url.Values{
		"source_id": {strconv.FormatUint(sourceID, 10)},
	}
	if afterFile != 0 {
		query.Set("after_file", strconv.FormatUint(afterFile, 10))
		query.Set("page_epoch", epoch)
	}
	var page RecoveryReviewPage
	if err := c.request(ctx, http.MethodGet,
		"/v1/device-backups/local-common-batch/recovery-review?"+query.Encode(),
		nil, &page); err != nil {
		return empty, err
	}
	if !ValidateRecoveryReviewPage(page, sourceID, afterFile, epoch) {
		return empty, errors.New("invalid owning Agent historical recovery review")
	}
	return page, nil
}
