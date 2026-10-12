package main

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// validateLocalQuarantineRecoveryPage is defense in depth for the owning
// Agent's private recovery transport. Its evidence IDs are only quarantined
// proposals, never a durable content proof or authority to commit an alias.
func validateLocalQuarantineRecoveryPage(page client.LocalCommitIntentPage, sourceID, revision, afterID uint64) error {
	if sourceID == 0 || revision == 0 || page.SourceID != sourceID ||
		page.Revision != revision || page.EvidenceIDs == nil ||
		len(page.EvidenceIDs) > localQuarantinePageLimit ||
		page.CommitSupported || page.Authoritative || page.MissingInferenceSafe ||
		(page.HasMore && len(page.EvidenceIDs) != localQuarantinePageLimit) {
		return errors.New("unsafe local quarantine recovery page")
	}
	previous := afterID
	for _, id := range page.EvidenceIDs {
		if id <= previous {
			return errors.New("unordered local quarantine recovery IDs")
		}
		previous = id
	}
	if len(page.EvidenceIDs) == 0 {
		if page.HasMore || page.NextAfterID != 0 {
			return errors.New("invalid empty local quarantine recovery page")
		}
	} else if page.NextAfterID != previous {
		return errors.New("invalid local quarantine recovery cursor")
	}
	return nil
}

// readLocalBoundBackupQuarantineRecoveryPage is an Agent-PRIVATE, read-only
// owning-device step toward restart recovery after an uncertain E0b POST.
// It does not run automatically, does not expose Agent IPC / Renderer / Web,
// and never promotes a quarantined proposal into SourceItem/alias/CAS/Run.
func (c *agentController) readLocalBoundBackupQuarantineRecoveryPage(
	ctx context.Context, sourceID, afterEvidenceID uint64,
) (client.LocalCommitIntentPage, error) {
	var empty client.LocalCommitIntentPage
	if ctx == nil || sourceID == 0 {
		return empty, privateLocalSnapshotError(errors.New("invalid local Source recovery read"))
	}
	if !c.localFolderGrantMu.TryLock() {
		return empty, privateLocalSnapshotError(errors.New("owning Agent recovery busy"))
	}
	defer c.localFolderGrantMu.Unlock()

	readCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	cfg, err := userconfig.Load()
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	source, proof, cli, err := c.localBoundBackupConfig(readCtx, sourceID)
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	rules, err := cli.LocalBoundRules(readCtx, sourceID, proof)
	if err != nil || rules.SourceID != sourceID || rules.Revision != source.Revision {
		return empty, privateLocalSnapshotError(errors.New("owning Source rules unavailable"))
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	grant, err := localpush.LoadRootGrant(configDir, cfg.Server, cfg.Username, proof.RootID)
	if err != nil || grant.SourceID != sourceID || grant.DeviceID != proof.DeviceID ||
		grant.RootID != proof.RootID || grant.Fingerprint != proof.RootFingerprint {
		return empty, privateLocalSnapshotError(errors.New("owning Root grant invalid"))
	}
	generations, err := localpush.LoadLocalReconcileEvidence(readCtx, configDir, grant, source.Revision)
	if err != nil || generations.Authoritative || generations.MissingInferenceSafe {
		return empty, privateLocalSnapshotError(errors.New("sealed local generations unavailable"))
	}
	// The E0c Server endpoint verifies an unrevoked device and exact binding
	// in the transaction. The Agent checks its actual native Root both before
	// and after the network read, so a changed Root cannot surface old IDs.
	page, err := cli.ReadLocalSourceCommitIntentPage(
		readCtx, sourceID, source.Revision, proof,
		generations.PreviousSHA256, generations.CurrentSHA256,
		localQuarantinePageLimit, afterEvidenceID)
	if err != nil || validateLocalQuarantineRecoveryPage(page, sourceID, source.Revision, afterEvidenceID) != nil {
		return empty, privateLocalSnapshotError(errors.New("owning quarantine recovery read unavailable"))
	}

	grantNow, err := localpush.LoadRootGrant(configDir, cfg.Server, cfg.Username, proof.RootID)
	if err != nil || grantNow != grant {
		return empty, privateLocalSnapshotError(errors.New("owning Root changed during quarantine read"))
	}
	generationNow, err := localpush.LoadLocalReconcileEvidence(readCtx, configDir, grantNow, source.Revision)
	if err != nil || generationNow.IntegritySHA256 != generations.IntegritySHA256 ||
		generationNow.PreviousSHA256 != generations.PreviousSHA256 ||
		generationNow.CurrentSHA256 != generations.CurrentSHA256 {
		return empty, privateLocalSnapshotError(errors.New("local generations changed during quarantine read"))
	}
	rulesNow, err := cli.LocalBoundRules(readCtx, sourceID, proof)
	if err != nil || rulesNow.SourceID != sourceID || rulesNow.Revision != source.Revision ||
		rulesNow.IgnoreRules != rules.IgnoreRules ||
		localBackupRuleSessionUnchanged(cfg) != nil || readCtx.Err() != nil {
		return empty, privateLocalSnapshotError(errors.New("owning account or rules changed during read"))
	}
	// A second authenticated local bound Source check fences revocation or
	// Source/Root revision changes after the first Server read transaction.
	sourceNow, proofNow, _, err := c.localBoundBackupConfig(readCtx, sourceID)
	if err != nil || proofNow != proof || sourceNow.ID != source.ID ||
		sourceNow.Revision != source.Revision || readCtx.Err() != nil {
		return empty, privateLocalSnapshotError(errors.New("owning device binding changed during read"))
	}
	return page, nil
}
