package main

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

const localQuarantinePageLimit = 16

// validLocalQuarantineDigest accepts only the lower-case ASCII SHA-256 hex
// keys used by the private evidence contract, never a path or raw identifier.
func validLocalQuarantineDigest(value string) bool {
	if len(value) != 64 {
		return false
	}
	for i := 0; i < len(value); i++ {
		b := value[i]
		if !((b >= '0' && b <= '9') || (b >= 'a' && b <= 'f')) {
			return false
		}
	}
	return true
}

// localQuarantinePageSummary never crosses Agent IPC/Preload/Renderer/Web.
// It reports only quarantined, non-authoritative proposals, never uploads,
// committed aliases, verified cloud durability or deletion permission.
type localQuarantinePageSummary struct {
	SourceID             uint64
	Revision             uint64
	Quarantined          int
	Replayed             int
	HasMore              bool
	NextAfterID          uint64
	CommitSupported      bool
	Authoritative        bool
	MissingInferenceSafe bool
}

// Build one strictly ordered private batch. The caller must have obtained the
// page with owning-Agent credentials and sealed generation digests; never
// accept page entries from a UI, an owner-JWT-only endpoint or another device.
func localQuarantineCandidates(
	page client.LocalSourceItemEvidencePage, sourceID, revision, afterID uint64,
) ([]uint64, []localpush.LocalEvidenceContentCandidate, error) {
	if sourceID == 0 || revision == 0 || page.SourceID != sourceID ||
		page.Revision != revision || page.Authoritative || page.MissingInferenceSafe ||
		len(page.Items) > localQuarantinePageLimit ||
		(page.HasMore && len(page.Items) != localQuarantinePageLimit) {
		return nil, nil, errors.New("invalid owning Agent quarantine evidence page")
	}
	if len(page.Items) == 0 {
		if page.HasMore || page.NextAfterID != 0 {
			return nil, nil, errors.New("invalid empty quarantine page")
		}
		return nil, nil, nil
	}
	ids := make([]uint64, 0, len(page.Items))
	candidates := make([]localpush.LocalEvidenceContentCandidate, 0, len(page.Items))
	seenItems := make(map[uint64]struct{}, len(page.Items))
	seenNatives := make(map[string]struct{}, len(page.Items))
	seenDestinations := make(map[string]struct{}, len(page.Items))
	prev := afterID
	for _, item := range page.Items {
		if item.EvidenceID <= prev || item.SourceItemID == 0 ||
			item.PreviousPathKey == item.CurrentPathKey ||
			!validLocalQuarantineDigest(item.PreviousPathKey) ||
			!validLocalQuarantineDigest(item.CurrentPathKey) ||
			!validLocalQuarantineDigest(item.NativeIdentityKey) {
			return nil, nil, errors.New("invalid private quarantine candidate")
		}
		if _, exists := seenItems[item.SourceItemID]; exists {
			return nil, nil, errors.New("duplicate private SourceItem candidate")
		}
		if _, exists := seenNatives[item.NativeIdentityKey]; exists {
			return nil, nil, errors.New("duplicate private native identity")
		}
		if _, exists := seenDestinations[item.CurrentPathKey]; exists {
			return nil, nil, errors.New("duplicate private destination")
		}
		seenItems[item.SourceItemID] = struct{}{}
		seenNatives[item.NativeIdentityKey] = struct{}{}
		seenDestinations[item.CurrentPathKey] = struct{}{}
		prev = item.EvidenceID
		ids = append(ids, item.EvidenceID)
		candidates = append(candidates, localpush.LocalEvidenceContentCandidate{
			PreviousPathKey:   item.PreviousPathKey,
			CurrentPathKey:    item.CurrentPathKey,
			NativeIdentityKey: item.NativeIdentityKey,
		})
	}
	if page.NextAfterID != prev {
		return nil, nil, errors.New("invalid private quarantine page cursor")
	}
	return ids, candidates, nil
}

// This helper checks the entire write response and cancellation state, with
// no partial successes or retry assumptions after an ambiguous connection.
// Server writes may still have happened on timeout: caller retries only via
// the exact idempotent evidence-ID protocol, never a generic Source API.
func submitLocalQuarantineBatch(
	ctx context.Context, sourceID, revision uint64, ids []uint64,
	write func(context.Context, []uint64) (client.LocalCommitIntentResult, error),
) (client.LocalCommitIntentResult, error) {
	var empty client.LocalCommitIntentResult
	if ctx == nil || sourceID == 0 || revision == 0 || write == nil ||
		len(ids) == 0 || len(ids) > localQuarantinePageLimit {
		return empty, errors.New("invalid private quarantine work")
	}
	var prior uint64
	for _, id := range ids {
		if id <= prior {
			return empty, errors.New("unordered private quarantine batch")
		}
		prior = id
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	got, err := write(ctx, ids)
	if err != nil {
		return empty, err
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if got.SourceID != sourceID || got.Revision != revision ||
		got.Quarantined < 0 || got.Replayed < 0 ||
		got.Quarantined > len(ids) ||
		got.Replayed != len(ids)-got.Quarantined ||
		got.CommitSupported || got.Authoritative || got.MissingInferenceSafe {
		return empty, errors.New("unsafe quarantine result")
	}
	return got, nil
}

// quarantineLocalBoundBackupEvidencePage is a NATIVE AGENT-PRIVATE method.
// No Desktop IPC, HTTP route, preload binding, renderer callback or schedule
// invokes it. L03-E0b only prepares the safe future Agent execution path.
//
// The locally sealed PREVIOUS/CURRENT journals, Root, rules and live original
// file hashes are verified BEFORE an owning-device, revision-fenced quarantine
// write. The Server repeats its own device/Root/item/alias/Node checks in the
// write transaction. This still cannot prove cloud bytes or commit an alias.
func (c *agentController) quarantineLocalBoundBackupEvidencePage(
	ctx context.Context, sourceID, afterEvidenceID uint64,
) (localQuarantinePageSummary, error) {
	var empty localQuarantinePageSummary
	if ctx == nil || sourceID == 0 {
		return empty, privateLocalSnapshotError(errors.New("valid local Source required"))
	}
	if !c.localFolderGrantMu.TryLock() {
		return empty, privateLocalSnapshotError(errors.New("owning Agent operation busy"))
	}
	defer c.localFolderGrantMu.Unlock()
	workCtx, cancel := context.WithTimeout(ctx, 300*time.Second)
	defer cancel()

	cfg, err := userconfig.Load()
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	source, proof, cli, err := c.localBoundBackupConfig(workCtx, sourceID)
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	rules, err := cli.LocalBoundRules(workCtx, sourceID, proof)
	if err != nil || rules.SourceID != sourceID || rules.Revision != source.Revision {
		return empty, privateLocalSnapshotError(errors.New("owning rules or Source revision unavailable"))
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
	generation, err := localpush.LoadLocalReconcileEvidence(workCtx, configDir, grant, source.Revision)
	if err != nil || generation.Authoritative || generation.MissingInferenceSafe {
		return empty, privateLocalSnapshotError(errors.New("verified local generations unavailable"))
	}
	page, err := cli.ReadLocalSourceItemEvidencePage(
		workCtx, sourceID, source.Revision, proof,
		generation.PreviousSHA256, generation.CurrentSHA256,
		localQuarantinePageLimit, afterEvidenceID)
	if err != nil {
		return empty, privateLocalSnapshotError(errors.New("private Server evidence page unavailable"))
	}
	ids, candidates, err := localQuarantineCandidates(page, sourceID, source.Revision, afterEvidenceID)
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	if len(ids) != 0 {
		checked, err := cli.PreflightLocalSourceItemEvidence(
			workCtx, sourceID, source.Revision, proof,
			generation.PreviousSHA256, generation.CurrentSHA256, ids)
		if err != nil || !checked.ServerConsistent || checked.Checked != len(ids) ||
			checked.ContentVerified || checked.CommitSupported ||
			checked.Authoritative || checked.MissingInferenceSafe {
			return empty, privateLocalSnapshotError(errors.New("advisory identity changed before local hash"))
		}
		hashed, err := localpush.HashCurrentLocalEvidenceBatch(
			workCtx, configDir, grant, source.Revision, candidates)
		if err != nil || len(hashed.Digests) != len(ids) ||
			hashed.CloudContentVerified || hashed.Authoritative || hashed.MissingInferenceSafe {
			return empty, privateLocalSnapshotError(errors.New("native file identity or content changed"))
		}
		claims := make([]client.LocalEvidenceCloudDigest, 0, len(ids))
		for i, id := range ids {
			claims = append(claims, client.LocalEvidenceCloudDigest{
				EvidenceID: id, SHA256: hashed.Digests[i].SHA256,
				Size: hashed.Digests[i].Size,
			})
		}
		metadata, err := cli.CheckLocalSourceItemCloudMetadata(
			workCtx, sourceID, source.Revision, proof,
			generation.PreviousSHA256, generation.CurrentSHA256, claims)
		if err != nil || !metadata.CloudMetadataMatched ||
			metadata.Checked != len(claims) || metadata.CloudBytesVerified ||
			metadata.ContentVerified || metadata.CommitSupported ||
			metadata.Authoritative || metadata.MissingInferenceSafe {
			return empty, privateLocalSnapshotError(errors.New("cloud metadata differs from native original"))
		}
		// A local hash and CAS metadata match are transient observations,
		// NEVER a persistable content proof. Recheck current Server identity.
		again, err := cli.PreflightLocalSourceItemEvidence(
			workCtx, sourceID, source.Revision, proof,
			generation.PreviousSHA256, generation.CurrentSHA256, ids)
		if err != nil || !again.ServerConsistent || again.Checked != len(ids) ||
			again.ContentVerified || again.CommitSupported ||
			again.Authoritative || again.MissingInferenceSafe {
			return empty, privateLocalSnapshotError(errors.New("advisory identity changed after native hash"))
		}
	}
	// Do not issue ANY write if the local Root, sealed journals, ignore
	// rules, authenticated Server/account or context changed since reading.
	checkScope := func() error {
		grantNow, err := localpush.LoadRootGrant(configDir, cfg.Server, cfg.Username, proof.RootID)
		if err != nil || grantNow != grant {
			return errors.New("local Root authorization changed")
		}
		evidenceNow, err := localpush.LoadLocalReconcileEvidence(
			workCtx, configDir, grant, source.Revision)
		if err != nil || evidenceNow.IntegritySHA256 != generation.IntegritySHA256 {
			return errors.New("local inventory generation changed")
		}
		rulesNow, err := cli.LocalBoundRules(workCtx, sourceID, proof)
		if err != nil || rulesNow.SourceID != sourceID || rulesNow.Revision != source.Revision ||
			rulesNow.IgnoreRules != rules.IgnoreRules ||
			localBackupRuleSessionUnchanged(cfg) != nil || workCtx.Err() != nil {
			return errors.New("owning device, rules or account changed")
		}
		return nil
	}
	if err := checkScope(); err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	result := localQuarantinePageSummary{
		SourceID: sourceID, Revision: source.Revision, HasMore: page.HasMore,
		NextAfterID: page.NextAfterID, CommitSupported: false,
		Authoritative: false, MissingInferenceSafe: false,
	}
	if len(ids) != 0 {
		saved, err := submitLocalQuarantineBatch(
			workCtx, sourceID, source.Revision, ids,
			func(ctx context.Context, selected []uint64) (client.LocalCommitIntentResult, error) {
				return cli.QuarantineLocalSourceCommitIntents(
					ctx, sourceID, source.Revision, proof,
					generation.PreviousSHA256, generation.CurrentSHA256, selected)
			})
		if err != nil {
			// A network error cannot prove the transaction did not commit;
			// only an exact idempotent retry may later resolve ambiguity.
			return empty, privateLocalSnapshotError(errors.New("private quarantine uncertain; retry exact evidence IDs"))
		}
		result.Quarantined = saved.Quarantined
		result.Replayed = saved.Replayed
	}
	if err := checkScope(); err != nil {
		// Even if the Server saved proposals, NEVER promote or surface
		// success after a device revocation or account/Root change.
		return empty, privateLocalSnapshotError(err)
	}
	return result, nil
}
