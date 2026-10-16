package main

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

const (
	localStageRestartInspectLimit = 8
	localStageRestartUnresolved   = "unresolved_no_authority"
)

// Only an Agent-private, read-only observation. No field is JSON serializable,
// and even a confirmed CAS observation is NOT a native backup or SourceRun.
type localStageRestartInspection struct {
	StageID      string `json:"-"`
	SourceID     uint64 `json:"-"`
	Revision     uint64 `json:"-"`
	RelativePath string `json:"-"`
	State        string `json:"-"`
	CASObserved  bool   `json:"-"`
	NodeID       uint64 `json:"-"`
	SourceItemID uint64 `json:"-"`
}

type localStageRestartInspectionPage struct {
	Rows             []localStageRestartInspection `json:"-"`
	NextAfterStageID string                        `json:"-"`
	HasMore          bool                          `json:"-"`
	BackupComplete   bool                          `json:"-"`
	Authoritative    bool                          `json:"-"`
}

// selectLocalStageRestartPage is a bounded, deterministic private cursor.
// The journal may change between calls: this is NOT a complete Run snapshot.
// Unknown/malformed cursors, duplicate UUIDs and mixed Source scopes fail
// closed rather than presenting an incomplete set as authoritative.
func selectLocalStageRestartPage(
	hints []localpushstage.LocalOriginalRecoveryHint,
	sourceID uint64, afterStageID string, limit int,
) ([]localpushstage.LocalOriginalRecoveryHint, string, bool, error) {
	if sourceID == 0 || limit < 1 || limit > localStageRestartInspectLimit ||
		len(hints) > 128 {
		return nil, "", false, errors.New("invalid private restart recovery page")
	}
	if afterStageID != "" {
		id, err := uuid.Parse(afterStageID)
		if err != nil || id.String() != afterStageID {
			return nil, "", false, errors.New("invalid historical Stage cursor")
		}
	}
	ordered := append([]localpushstage.LocalOriginalRecoveryHint(nil), hints...)
	sort.Slice(ordered, func(i, j int) bool {
		return ordered[i].Stage.StageID < ordered[j].Stage.StageID
	})
	previous := ""
	foundCursor := afterStageID == ""
	start := 0
	for i, hint := range ordered {
		id, err := uuid.Parse(hint.Stage.StageID)
		if err != nil || id.String() != hint.Stage.StageID ||
			(previous != "" && hint.Stage.StageID <= previous) ||
			hint.Stage.SourceID != sourceID || hint.Stage.Revision == 0 ||
			hint.RelativePath == "" {
			return nil, "", false, errors.New("invalid historical private Stage record")
		}
		previous = hint.Stage.StageID
		if afterStageID != "" && hint.Stage.StageID == afterStageID {
			foundCursor = true
			start = i + 1
		}
	}
	if !foundCursor {
		return nil, "", false, errors.New("unrecognized historical Stage cursor")
	}
	end := start + limit
	if end > len(ordered) {
		end = len(ordered)
	}
	page := ordered[start:end]
	hasMore := end < len(ordered)
	next := ""
	if hasMore && len(page) > 0 {
		next = page[len(page)-1].Stage.StageID
	}
	return page, next, hasMore, nil
}

type localStageHistoricalReceiptReader func(
	context.Context, uint64, uint64, string, string,
) (client.LocalPushFirstLeafPhysicalReceipt, error)

// inspectLocalHistoricalStage is NOT a commit or restart queue. The old
// relative path may refer to a nested file unsupported by the ONE-leaf SQL
// writer, or a Stage not committed at all. Neither situation causes a write.
// Only the exact historical CAS/SQL receipt may be labelled CAS-observed.
func inspectLocalHistoricalStage(
	ctx context.Context, hint localpushstage.LocalOriginalRecoveryHint,
	sourceID, currentRevision uint64, read localStageHistoricalReceiptReader,
) (localStageRestartInspection, error) {
	var empty localStageRestartInspection
	if ctx == nil || read == nil || sourceID == 0 || currentRevision == 0 ||
		hint.Stage.SourceID != sourceID || hint.Stage.Revision == 0 {
		return empty, errors.New("invalid private historical Stage scope")
	}
	id, err := uuid.Parse(hint.Stage.StageID)
	if err != nil || id.String() != hint.Stage.StageID {
		return empty, errors.New("invalid historical Stage identifier")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	row := localStageRestartInspection{
		StageID: hint.Stage.StageID, SourceID: sourceID,
		Revision: hint.Stage.Revision, RelativePath: hint.RelativePath,
		State: localStageRestartUnresolved,
	}
	// Older Source revisions and nested paths remain unresolved. A stored
	// Stage hint cannot override current Root/Source authorization.
	leaf := hint.RelativePath
	if hint.Stage.Revision != currentRevision ||
		leaf == "." || leaf == ".." ||
		leaf == "" || len(leaf) > 255 ||
		strings.TrimSpace(leaf) != leaf ||
		strings.ContainsAny(leaf, "/\\") {
		return row, nil
	}
	receipt, err := read(ctx, sourceID, currentRevision, hint.Stage.StageID, leaf)
	if ctx.Err() != nil {
		return empty, ctx.Err()
	}
	if err != nil || !historicalPhysicalReceiptMatches(
		receipt, sourceID, currentRevision, hint.Stage.StageID,
	) {
		return row, nil
	}
	row.CASObserved = true
	row.State = localPhysicalReceiptRecoveryState
	row.NodeID = receipt.NodeID
	row.SourceItemID = receipt.SourceItemID
	return row, nil
}

// inspectLocalBoundBackupStageRestartPage is a STRICTLY PRIVATE, opt-in,
// unexported Agent reconciliation read. It has NO startup/watcher/IPC/Renderer
// or scheduler caller; it never deletes hints, uploads bytes, commits a File,
// activates a Source, marks SourceItem synced or begins/finishes a SourceRun.
//
// An old Stage may have expired or been replaced. This only asks whether its
// past CAS/SQL first-file commit currently has a physical CAS observation.
func (c *agentController) inspectLocalBoundBackupStageRestartPage(
	ctx context.Context, sourceID uint64, afterStageID string, limit int,
) (localStageRestartInspectionPage, error) {
	var empty localStageRestartInspectionPage
	if c == nil || ctx == nil || sourceID == 0 || limit < 1 ||
		limit > localStageRestartInspectLimit {
		return empty, privateLocalPhysicalReceiptError(errors.New("invalid Stage recovery request"))
	}
	readCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	if err := readCtx.Err(); err != nil {
		return empty, privateLocalPhysicalReceiptError(err)
	}
	account, err := userconfig.Load()
	if err != nil {
		return empty, privateLocalPhysicalReceiptError(err)
	}
	source, proof, _, err := c.localBoundBackupConfig(readCtx, sourceID)
	if err != nil || source.ID != sourceID || source.Revision == 0 ||
		proof.DeviceID == "" || proof.DeviceToken == "" ||
		source.TargetNodeID == nil || *source.TargetNodeID == 0 {
		return empty, privateLocalPhysicalReceiptError(errors.New("owning Source unavailable"))
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, privateLocalPhysicalReceiptError(err)
	}
	grant, err := localpush.LoadRootGrant(
		configDir, account.Server, account.Username, proof.RootID,
	)
	if err != nil || grant.SourceID != sourceID ||
		grant.DeviceID != proof.DeviceID || grant.RootID != proof.RootID ||
		grant.Fingerprint != proof.RootFingerprint || !grant.StrongIdentity {
		return empty, privateLocalPhysicalReceiptError(errors.New("owning Root invalid"))
	}
	hints, err := localpushstage.ListLocalOriginalRecoveryHints(
		readCtx, configDir, grant,
	)
	if err != nil {
		return empty, privateLocalPhysicalReceiptError(err)
	}
	selected, next, hasMore, err := selectLocalStageRestartPage(
		hints, sourceID, afterStageID, limit,
	)
	if err != nil {
		return empty, privateLocalPhysicalReceiptError(err)
	}
	out := localStageRestartInspectionPage{
		Rows:             make([]localStageRestartInspection, 0, len(selected)),
		NextAfterStageID: next, HasMore: hasMore,
		BackupComplete: false, Authoritative: false,
	}
	for _, hint := range selected {
		row, err := inspectLocalHistoricalStage(
			readCtx, hint, sourceID, source.Revision,
			func(ctx context.Context, id, revision uint64, stageID, leaf string) (
				client.LocalPushFirstLeafPhysicalReceipt, error,
			) {
				// The existing own-device private reader repeatedly checks
				// account, credential, native Root and Source on BOTH sides
				// of every authenticated historical physical CAS GET.
				return c.readLocalBoundBackupHistoricalPhysicalReceipt(
					ctx, id, revision, stageID, leaf,
				)
			},
		)
		if err != nil {
			return empty, privateLocalPhysicalReceiptError(err)
		}
		out.Rows = append(out.Rows, row)
	}
	// Recheck entire scope after the batch. Never return earlier successful
	// observations after an account switch, rebinding or Root change.
	latestRoot, err := localpush.LoadRootGrant(
		configDir, account.Server, account.Username, proof.RootID,
	)
	if err != nil || latestRoot != grant ||
		localBackupRuleSessionUnchanged(account) != nil || readCtx.Err() != nil {
		return empty, privateLocalPhysicalReceiptError(errors.New("owning Root or account changed"))
	}
	afterSource, afterProof, _, err := c.localBoundBackupConfig(readCtx, sourceID)
	if err != nil || afterProof != proof ||
		afterSource.ID != source.ID || afterSource.Revision != source.Revision ||
		afterSource.Status != source.Status || afterSource.SyncMode != source.SyncMode ||
		afterSource.TargetNodeID == nil ||
		*afterSource.TargetNodeID != *source.TargetNodeID ||
		readCtx.Err() != nil {
		return empty, privateLocalPhysicalReceiptError(errors.New("owning Source changed"))
	}
	return out, nil
}
