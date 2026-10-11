package main

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// readLocalBoundBackupEvidencePage is an Agent-PRIVATE reconciliation helper.
// It is intentionally absent from Desktop IPC, Electron Preload, and Web.
// SourceItem IDs and opaque native path keys must not reach a renderer or a
// remote device. A page is advisory even after both journals are verified.
func (c *agentController) readLocalBoundBackupEvidencePage(
	ctx context.Context, sourceID uint64, limit int, afterEvidenceID uint64,
) (client.LocalSourceItemEvidencePage, error) {
	var empty client.LocalSourceItemEvidencePage
	if ctx == nil || sourceID == 0 || limit < 1 || limit > 64 {
		return empty, privateLocalSnapshotError(errors.New("invalid advisory page"))
	}
	if !c.localFolderGrantMu.TryLock() {
		return empty, privateLocalSnapshotError(errors.New("owning Agent busy"))
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
		return empty, privateLocalSnapshotError(errors.New("private source rules unavailable"))
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	grant, err := localpush.LoadRootGrant(configDir, cfg.Server, cfg.Username, proof.RootID)
	if err != nil || grant.SourceID != sourceID || grant.DeviceID != proof.DeviceID ||
		grant.RootID != proof.RootID || grant.Fingerprint != proof.RootFingerprint {
		return empty, privateLocalSnapshotError(errors.New("owning Root grant changed"))
	}
	generation, err := localpush.LoadLocalReconcileEvidence(readCtx, configDir, grant, source.Revision)
	if err != nil || generation.Authoritative || generation.MissingInferenceSafe {
		return empty, privateLocalSnapshotError(errors.New("verified local generations unavailable"))
	}
	page, err := cli.ReadLocalSourceItemEvidencePage(
		readCtx, sourceID, source.Revision, proof,
		generation.PreviousSHA256, generation.CurrentSHA256, limit, afterEvidenceID)
	if err != nil || page.Authoritative || page.MissingInferenceSafe {
		return empty, privateLocalSnapshotError(errors.New("private advisory evidence page unavailable"))
	}

	// A credential, Root, inventory, rule or account revision that changes
	// while the network call is in flight invalidates the entire reply.
	current, err := localpush.LoadLocalReconcileEvidence(readCtx, configDir, grant, source.Revision)
	if err != nil || current.IntegritySHA256 != generation.IntegritySHA256 {
		return empty, privateLocalSnapshotError(errors.New("private inventory changed during read"))
	}
	rulesNow, err := cli.LocalBoundRules(readCtx, sourceID, proof)
	if err != nil || rulesNow.SourceID != sourceID || rulesNow.Revision != source.Revision ||
		rulesNow.IgnoreRules != rules.IgnoreRules ||
		localBackupRuleSessionUnchanged(cfg) != nil || readCtx.Err() != nil {
		return empty, privateLocalSnapshotError(errors.New("owning Agent authority changed during read"))
	}
	return page, nil
}
