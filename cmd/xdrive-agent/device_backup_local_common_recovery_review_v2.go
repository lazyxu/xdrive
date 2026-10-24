//go:build linux || windows

package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"time"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// Classify only receipt data that passed the strict original SQL group audit.
// A prior committed result does not imply current Node/CAS presence.
func classifyLocalCommonReadOnlyOriginals(originals []localpushcommon.VerifiedOriginalReceipt) (string, bool) {
	if len(originals) == 0 {
		return "unrecorded", true
	}
	pending := false
	for _, original := range originals {
		switch original.Receipt.State {
		case "committed":
			if !original.Receipt.Committed {
				return "", false
			}
		case "reserved", "bound":
			if original.Receipt.Committed {
				return "", false
			}
			pending = true
		default:
			return "", false
		}
	}
	if pending {
		return "pending", true
	}
	return "historical_committed", true
}

// A private HMAC pins a *local* inventory generation and checkpoint
// across numeric pages without disclosing the raw manifest hash, Root,
// Owner session or server credentials. It grants no authentication or
// current Node/CAS authority; all ordinary Owner checks still run.
func localCommonRecoveryReviewEpoch(
	session string, grant localpush.RootGrant, revision, targetNodeID uint64,
	snapshot localpush.InventoryJournalSnapshot,
	checkpoint localpush.CommonBatchCheckpoint, ignoreRules string,
) string {
	if session == "" || !grant.StrongIdentity || revision == 0 || targetNodeID == 0 ||
		snapshot.SnapshotSHA256 == "" || checkpoint.RunID == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(session))
	for _, value := range []string{
		"xdrive/localpush/recovery-review-epoch/v1",
		grant.Server, grant.Account, grant.DeviceID, grant.RootID,
		grant.Fingerprint, strconv.FormatUint(grant.SourceID, 10),
		strconv.FormatUint(revision, 10),
		strconv.FormatUint(targetNodeID, 10),
		snapshot.SnapshotName, snapshot.SnapshotSHA256,
		checkpoint.RunID, checkpoint.UpdatedAt.UTC().Format(time.RFC3339Nano),
		checkpoint.State, ignoreRules,
	} {
		_, _ = mac.Write([]byte(value))
		_, _ = mac.Write([]byte{0})
	}
	return hex.EncodeToString(mac.Sum(nil))
}

// CloudLocalBoundBackupCommonRecoveryReview observes at most sixteen files
// selected by ORDINAL, not by a renderer-supplied path or Operation ID.
// Streaming validates the entire private manifest before any result escapes.
// All network calls are owning Agent Source/Root reads or original SQL receipt
// readbacks; this cannot Admit, Bind, Chunk, Finalize, delete or retry writes.
func (c *agentController) CloudLocalBoundBackupCommonRecoveryReview(
	ctx context.Context, sourceID, afterFile uint64, requestedEpoch string,
) (localCommonRecoveryReviewPage, error) {
	var zero localCommonRecoveryReviewPage
	if c == nil || ctx == nil || ctx.Err() != nil || c.ctx == nil ||
		c.ctx.Err() != nil || sourceID == 0 ||
		afterFile > localCommonRecoveryReviewMaxAfter ||
		!c.localFolderGrantMu.TryLock() {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	defer c.localFolderGrantMu.Unlock()

	readCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	account, err := userconfig.Load()
	if err != nil || account.SessionInvalid || account.Server == "" ||
		account.Username == "" || account.SessionID == "" {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	source, proof, api, err := c.localBoundBackupConfig(readCtx, sourceID)
	if err != nil || api == nil || source.ID != sourceID ||
		source.Revision == 0 || source.SyncMode != meta.SourceSyncModeBackup ||
		source.TargetNodeID == nil || *source.TargetNodeID == 0 {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	dir, err := userconfig.Dir()
	if err != nil {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	grant, err := localpush.LoadRootGrant(dir, account.Server, account.Username, proof.RootID)
	if err != nil || !grant.StrongIdentity || grant.SourceID != sourceID ||
		grant.Server != account.Server || grant.Account != account.Username ||
		grant.DeviceID != proof.DeviceID || grant.RootID != proof.RootID ||
		grant.Fingerprint != proof.RootFingerprint ||
		localpush.VerifyRootGrant(grant) != nil {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	checkpoint, err := localpush.ReadVerifiedCommonBatchCheckpoint(
		readCtx, dir, grant, account.SessionID, source.Revision)
	if err != nil || checkpoint.State == "running" ||
		checkpoint.BackupComplete || checkpoint.RetirementSafe ||
		checkpoint.CurrentCASVerified {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	rules, err := api.LocalBoundRules(readCtx, sourceID, proof)
	if err != nil || rules.SourceID != sourceID ||
		rules.Revision != source.Revision {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	matcher, err := sourcepkg.CompileIgnoreRules(rules.IgnoreRules)
	if err != nil {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	page := localCommonRecoveryReviewPage{
		SourceID: sourceID, Revision: source.Revision,
		RunState: checkpoint.State, Authoritative: false,
	}
	var fileIndex uint64
	lastSelected := afterFile
	snapshot, err := localpush.StreamVerifiedInventoryJournal(readCtx, dir, grant,
		localpush.DefaultInventoryBatchSize, func(items []localpush.InventoryItem) error {
			for _, item := range items {
				if item.Kind != "file" {
					continue
				}
				fileIndex++
				if fileIndex <= afterFile {
					continue
				}
				if page.ReviewedFiles == localCommonRecoveryReviewPageSize {
					page.HasMore = true
					continue
				}
				lastSelected = fileIndex
				page.ReviewedFiles++
				if item.Ignored || matcher.Ignored(item.Path, false) {
					page.IgnoredFiles++
					continue
				}
				if !eligibleLocalBackupCommonBatchFile(item) {
					page.UnsupportedFiles++
					continue
				}
				plans, err := localpush.ListVerifiedCommonUploadVersionedPlans(
					dir, grant, account.SessionID, item.Path)
				if err != nil {
					return err
				}
				if len(plans) == 0 {
					page.UnrecordedFiles++
					continue
				}
				originals, err := localpushcommon.ReadVerifiedOriginalFileReceipts(
					readCtx, api, proof, sourceID, source.Revision, plans)
				if err != nil {
					return err
				}
				category, valid := classifyLocalCommonReadOnlyOriginals(originals)
				if !valid {
					return errLocalBackupCommonBatchUnavailable
				}
				switch category {
				case "pending":
					page.PendingFiles++
				case "historical_committed":
					page.HistoricalCommitted++
					// Read ONLY the current Source-authorized cloud
					// descendant and compare it with the complete
					// immutable committed Node revision chain. This
					// observes metadata, NEVER present CAS bytes.
					parentID, name, parentErr := localCommonFindExistingCloudParent(
						readCtx, api, sourceID, source.Revision,
						*source.TargetNodeID, proof, item.Path)
					if parentErr != nil {
						return parentErr
					}
					currentNode, nodeErr := localCommonRootCurrentChild(
						readCtx, api, parentID, name)
					if nodeErr != nil {
						return nodeErr
					}
					if !localCommonHistoricalMatchesCurrentNode(
						item.Path, parentID, currentNode, originals) {
						page.CurrentNodeMismatch++
					} else {
						// A second read rejects a Node edited during
						// this page. This still is not current CAS
						// physical verification or upload permission.
						if err := localCommonVerifyCloudFileUnchanged(
							readCtx, api, parentID, currentNode); err != nil {
							return err
						}
						page.CurrentNodeMatch++
					}
				default:
					return errLocalBackupCommonBatchUnavailable
				}
			}
			return readCtx.Err()
		})
	if err != nil || readCtx.Err() != nil || fileIndex < afterFile {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	rulesNow, err := api.LocalBoundRules(readCtx, sourceID, proof)
	if err != nil || rulesNow.SourceID != sourceID ||
		rulesNow.Revision != source.Revision ||
		rulesNow.IgnoreRules != rules.IgnoreRules {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	sourceNow, proofNow, _, err := c.localBoundBackupConfig(readCtx, sourceID)
	if err != nil || sourceNow.ID != sourceID || sourceNow.Revision != source.Revision ||
		sourceNow.SyncMode != meta.SourceSyncModeBackup ||
		sourceNow.TargetNodeID == nil || *sourceNow.TargetNodeID != *source.TargetNodeID ||
		proofNow != proof || readCtx.Err() != nil {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	// A different Agent process might replace CURRENT while we were
	// reading the prior immutable generation. Historical facts are not
	// exposed unless the same generation is still CURRENT.
	currentNow, err := localpush.VerifyInventoryJournal(readCtx, dir, grant)
	if err != nil || currentNow.SnapshotName != snapshot.SnapshotName ||
		currentNow.SnapshotSHA256 != snapshot.SnapshotSHA256 {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	epoch := localCommonRecoveryReviewEpoch(account.SessionID, grant,
		source.Revision, *source.TargetNodeID, snapshot, checkpoint, rules.IgnoreRules)
	if epoch == "" || (afterFile != 0 && !hmac.Equal(
		[]byte(epoch), []byte(requestedEpoch))) {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	grantNow, err := localpush.LoadRootGrant(dir, account.Server, account.Username, proof.RootID)
	if err != nil || grantNow != grant ||
		localpush.VerifyRootGrant(grantNow) != nil {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	checkpointNow, err := localpush.ReadVerifiedCommonBatchCheckpoint(
		readCtx, dir, grant, account.SessionID, source.Revision)
	if err != nil || checkpointNow != checkpoint ||
		localBackupRuleSessionUnchanged(account) != nil {
		return zero, errLocalBackupCommonBatchUnavailable
	}
	if page.HasMore {
		page.NextAfterFile = lastSelected
	}
	page.PageEpoch = epoch
	return page, nil
}
