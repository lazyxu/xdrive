package localpushstage

import (
	"context"
	"errors"
	"fmt"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
)

// LocalVerifiedRenameStageSummary counts PRIVATE, provisional evidence rows.
// Success does not make any SourceItem identity, SourceRun or Mirror action safe.
type LocalVerifiedRenameStageSummary struct {
	Hints                int64
	Matched              int64
	Unmatched            int64
	Stored               int64
	Replayed             int64
	Authoritative        bool
	MissingInferenceSafe bool
}

// StageVerifiedLocalRenameEvidence is an Agent-only integration primitive.
// Its caller must hold the OS credential, current Root grant, private source
// rule revision and account/session lock. It is deliberately not bound to
// Web, Electron Preload, renderer, Agent IPC, or a background scheduler.
//
// It validates BOTH completed journals and the sealed local reconciliation
// manifest before contacting the Server. An independent dry pass checks the
// complete native-rename hint set before any advisory inserts are attempted.
// A later network failure may leave partial *advisory* rows; exact retries are
// idempotent and no row is consulted by the authoritative identity planner.
func StageVerifiedLocalRenameEvidence(
	c *client.Client, ctx context.Context, configDir string, grant localpush.RootGrant,
	revision uint64, proof client.LocalBoundSourceProof,
) (LocalVerifiedRenameStageSummary, error) {
	var empty LocalVerifiedRenameStageSummary
	if ctx == nil || c == nil || configDir == "" || revision == 0 ||
		grant.SourceID == 0 || proof.DeviceID == "" || proof.DeviceToken == "" ||
		proof.DeviceID != grant.DeviceID || proof.RootID != grant.RootID ||
		proof.RootFingerprint != grant.Fingerprint {
		return empty, errors.New("owning Agent identity, Root and revision are required")
	}
	if err := localpush.VerifyRootGrant(grant); err != nil {
		return empty, err
	}
	manifest, err := localpush.LoadLocalReconcileEvidence(ctx, configDir, grant, revision)
	if err != nil {
		return empty, err
	}
	const batchSize = 64 // two path keys per hint, <=128 IDs per protected lookup
	dry, err := localpush.StreamInventoryNativeRenameHints(
		ctx, configDir, grant, batchSize,
		func([]localpush.InventoryRenameHint) error { return ctx.Err() },
	)
	if err != nil {
		return empty, err
	}
	if !verifiedRenameGeneration(manifest, dry) {
		return empty, errors.New("advisory generation or rename-hint counts changed")
	}
	result := LocalVerifiedRenameStageSummary{Hints: dry.Hints}
	if dry.Hints == 0 {
		return result, nil
	}
	var streamed int64
	actual, err := localpush.StreamInventoryNativeRenameHints(
		ctx, configDir, grant, batchSize, func(hints []localpush.InventoryRenameHint) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			// The Server separately rechecks owner, device credential, bound
			// Root and Source revision for lookup AND each provisional insert.
			if err := localpush.VerifyRootGrant(grant); err != nil {
				return err
			}
			matched, unmatched, stored, replayed, err := stageLocalRenameBatch(
				c, ctx, grant, revision, proof, manifest, hints)
			if err != nil {
				return err
			}
			streamed += int64(len(hints))
			result.Matched += matched
			result.Unmatched += unmatched
			result.Stored += stored
			result.Replayed += replayed
			return nil
		},
	)
	if err != nil {
		return empty, err
	}
	// A concurrent snapshot rotation, revocation or other Agent change
	// cannot be reported as a successful reconciliation. Any rows already
	// staged remain non-authoritative and will never trigger cloud actions.
	latest, err := localpush.LoadLocalReconcileEvidence(ctx, configDir, grant, revision)
	if err != nil {
		return empty, err
	}
	if latest.IntegritySHA256 != manifest.IntegritySHA256 ||
		!verifiedRenameGeneration(latest, actual) ||
		actual.Hints != dry.Hints || streamed != dry.Hints ||
		result.Matched+result.Unmatched != result.Hints ||
		result.Stored+result.Replayed != result.Matched {
		return empty, errors.New("local advisory generation changed during staging")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return result, nil
}

func verifiedRenameGeneration(
	manifest localpush.LocalReconcileEvidence, hints localpush.InventoryRenameHintSummary,
) bool {
	return !manifest.Authoritative && !manifest.MissingInferenceSafe &&
		!hints.MissingInferenceSafe && !hints.Delta.MissingInferenceSafe &&
		manifest.PreviousSnapshot == hints.Delta.Previous.SnapshotName &&
		manifest.PreviousSHA256 == hints.Delta.Previous.SnapshotSHA256 &&
		manifest.PreviousItems == hints.Delta.Previous.Items &&
		manifest.CurrentSnapshot == hints.Delta.Current.SnapshotName &&
		manifest.CurrentSHA256 == hints.Delta.Current.SnapshotSHA256 &&
		manifest.CurrentItems == hints.Delta.Current.Items &&
		manifest.Added == hints.Delta.Added &&
		manifest.AbsentCandidates == hints.Delta.AbsentCandidates &&
		manifest.Changed == hints.Delta.Changed &&
		manifest.MetadataStable == hints.Delta.MetadataStable &&
		hints.Hints >= 0 && hints.Hints <= hints.Delta.Added &&
		hints.Hints <= hints.Delta.AbsentCandidates
}

// stageLocalRenameBatch never accepts external paths or renderer DTOs.
// Canonical previous-path IDs must ALREADY exist on the Server. New-path
// collisions fail closed; unmatched hints are not invented as SourceItems.
func stageLocalRenameBatch(
	c *client.Client, ctx context.Context, grant localpush.RootGrant, revision uint64,
	proof client.LocalBoundSourceProof, manifest localpush.LocalReconcileEvidence,
	hints []localpush.InventoryRenameHint,
) (matched, unmatched, stored, replayed int64, err error) {
	if ctx == nil || len(hints) == 0 || len(hints) > 64 ||
		grant.SourceID == 0 || revision == 0 {
		return 0, 0, 0, 0, errors.New("invalid private rename batch")
	}
	keys := make([]string, 0, 2*len(hints))
	for _, hint := range hints {
		if hint.PreviousPath == hint.CurrentPath || hint.NativeIdentityKey == "" {
			return 0, 0, 0, 0, errors.New("unsafe local rename hint")
		}
		previous, keyErr := localpush.LocalInventoryPathKey(grant, "file", hint.PreviousPath)
		if keyErr != nil {
			return 0, 0, 0, 0, keyErr
		}
		current, keyErr := localpush.LocalInventoryPathKey(grant, "file", hint.CurrentPath)
		if keyErr != nil || previous == current {
			return 0, 0, 0, 0, errors.New("invalid new local rename path")
		}
		keys = append(keys, previous, current)
	}
	found, err := c.LocalSourceIdentityLookup(ctx, grant.SourceID, revision, proof, keys)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	known := make(map[int]uint64, len(found.Matches))
	for _, item := range found.Matches {
		known[item.Index] = item.SourceItemID
	}
	for i, hint := range hints {
		if err := ctx.Err(); err != nil {
			return 0, 0, 0, 0, err
		}
		oldItem := known[2*i]
		newItem := known[2*i+1]
		if oldItem == 0 {
			if newItem != 0 {
				return 0, 0, 0, 0, errors.New("new local path collides with an existing identity")
			}
			unmatched++
			continue
		}
		if newItem != 0 && newItem != oldItem {
			return 0, 0, 0, 0, errors.New("local identity lookup found a different destination SourceItem")
		}
		input := client.LocalSourceItemEvidenceInput{
			SourceItemID:           oldItem,
			PreviousSnapshotSHA256: manifest.PreviousSHA256,
			CurrentSnapshotSHA256:  manifest.CurrentSHA256,
			PreviousPathKey:        keys[2*i], CurrentPathKey: keys[2*i+1],
			PreviousNativeKey: hint.NativeIdentityKey,
			CurrentNativeKey:  hint.NativeIdentityKey,
			PreviousStrong:    true, CurrentStrong: true,
			PreviousLinkCount: 1, CurrentLinkCount: 1,
		}
		evidence, writeErr := c.StoreLocalSourceItemEvidence(
			ctx, grant.SourceID, revision, proof, input)
		if writeErr != nil {
			return 0, 0, 0, 0, fmt.Errorf("advisory identity evidence not stored: %w", writeErr)
		}
		matched++
		if evidence.Replayed {
			replayed++
		} else {
			stored++
		}
	}
	return matched, unmatched, stored, replayed, nil
}
