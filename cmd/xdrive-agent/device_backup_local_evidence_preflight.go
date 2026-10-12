package main

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// This deliberately Agent-private summary never enters Web, Desktop IPC,
// Preload or Renderer. It is NOT a commit token or permission to upload.
type localEvidencePreflightSummary struct {
	SourceID                 uint64
	Revision                 uint64
	Checked                  int
	LocallyHashedFiles       int
	LocallyHashedBytes       int64
	CloudContentVerified     bool
	CloudMetadataMatched     bool
	MetadataMatchedFiles     int
	PhysicalCASObservedFiles int
	PhysicalCASObservedBytes int64
	HasMore                  bool
	NextAfterID              uint64
	ServerConsistent         bool
	ContentVerified          bool
	CommitSupported          bool
	Authoritative            bool
	MissingInferenceSafe     bool
}

// preflightLocalBoundBackupEvidencePage reads one private advisory page and
// rechecks current Server SourceItem/Node/alias consistency, then hashes the
// actual current authorized original files against BOTH sealed journals.
// It also checks current Server File/FileVersion/CAS *metadata* but NEVER
// reads physical cloud object bytes or issues a durable commit token.
func (c *agentController) preflightLocalBoundBackupEvidencePage(
	ctx context.Context, sourceID uint64, afterEvidenceID uint64,
) (localEvidencePreflightSummary, error) {
	var empty localEvidencePreflightSummary
	if ctx == nil || sourceID == 0 {
		return empty, privateLocalSnapshotError(errors.New("valid own Source required"))
	}
	if !c.localFolderGrantMu.TryLock() {
		return empty, privateLocalSnapshotError(errors.New("owning Agent busy"))
	}
	defer c.localFolderGrantMu.Unlock()

	readCtx, cancel := context.WithTimeout(ctx, 300*time.Second)
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
		return empty, privateLocalSnapshotError(errors.New("private rules or revision unavailable"))
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
		return empty, privateLocalSnapshotError(errors.New("verified generations unavailable"))
	}
	page, err := cli.ReadLocalSourceItemEvidencePage(
		readCtx, sourceID, source.Revision, proof,
		generation.PreviousSHA256, generation.CurrentSHA256, 64, afterEvidenceID)
	if err != nil || page.Authoritative || page.MissingInferenceSafe {
		return empty, privateLocalSnapshotError(errors.New("private evidence page unavailable"))
	}
	result := localEvidencePreflightSummary{
		SourceID: sourceID, Revision: source.Revision, HasMore: page.HasMore,
		NextAfterID: page.NextAfterID, ContentVerified: false,
		CommitSupported: false, Authoritative: false, MissingInferenceSafe: false,
	}
	if len(page.Items) != 0 {
		ids := make([]uint64, 0, len(page.Items))
		for _, item := range page.Items {
			ids = append(ids, item.EvidenceID)
		}
		checked, err := cli.PreflightLocalSourceItemEvidence(
			readCtx, sourceID, source.Revision, proof,
			generation.PreviousSHA256, generation.CurrentSHA256, ids)
		if err != nil || !checked.ServerConsistent ||
			checked.ContentVerified || checked.CommitSupported ||
			checked.Authoritative || checked.MissingInferenceSafe ||
			checked.Checked != len(page.Items) {
			return empty, privateLocalSnapshotError(errors.New("advisory rows no longer match Server"))
		}
		// Only native journal keys go into the local verifier; filesystem
		// paths and SHA-256 digests never enter Renderer/Web/Agent IPC.
		candidates := make([]localpush.LocalEvidenceContentCandidate, 0, len(page.Items))
		for _, item := range page.Items {
			candidates = append(candidates, localpush.LocalEvidenceContentCandidate{
				PreviousPathKey: item.PreviousPathKey, CurrentPathKey: item.CurrentPathKey,
				NativeIdentityKey: item.NativeIdentityKey,
			})
		}
		hashed, err := localpush.HashCurrentLocalEvidenceBatch(
			readCtx, configDir, grant, source.Revision, candidates)
		if err != nil || len(hashed.Digests) != len(page.Items) ||
			hashed.CloudContentVerified || hashed.Authoritative ||
			hashed.MissingInferenceSafe {
			return empty, privateLocalSnapshotError(errors.New("current native file content is no longer consistent"))
		}
		// Cross-check the ephemeral native digest against the Server's current
		// File, exact FileVersion and ready CAS ContentBlob metadata. No file
		// path, cloud storage key or per-file digest is returned from Server.
		claims := make([]client.LocalEvidenceCloudDigest, 0, len(page.Items))
		for i, item := range page.Items {
			claims = append(claims, client.LocalEvidenceCloudDigest{
				EvidenceID: item.EvidenceID,
				SHA256:     hashed.Digests[i].SHA256,
				Size:       hashed.Digests[i].Size,
			})
		}
		metadata, err := cli.CheckLocalSourceItemCloudMetadata(
			readCtx, sourceID, source.Revision, proof,
			generation.PreviousSHA256, generation.CurrentSHA256, claims)
		if err != nil || !metadata.CloudMetadataMatched ||
			metadata.Checked != len(claims) || metadata.CloudBytesVerified ||
			metadata.ContentVerified || metadata.CommitSupported ||
			metadata.Authoritative || metadata.MissingInferenceSafe {
			return empty, privateLocalSnapshotError(errors.New("cloud metadata no longer matches local original bytes"))
		}

		// Proof-of-storage pilot: sample at most ONE small actual CAS object
		// per explicitly requested private evidence page. This rehashes
		// Server storage outside the DB lock and repeats DB proof after read.
		// Other candidates (and any object >64 MiB) remain PHYSICALLY
		// UNVERIFIED; the complete page is never a commit/mirror token.
		if len(claims) != 0 && claims[0].Size <= 64<<20 {
			physical, err := cli.CheckLocalSourceItemCloudBytes(
				readCtx, sourceID, source.Revision, proof,
				generation.PreviousSHA256, generation.CurrentSHA256, claims[0])
			if err != nil || physical.Checked != 1 ||
				!physical.CloudMetadataMatched || !physical.PhysicalCASMatched ||
				physical.CloudBytesVerified || physical.ContentVerified ||
				physical.CommitSupported || physical.Authoritative ||
				physical.MissingInferenceSafe {
				return empty, privateLocalSnapshotError(errors.New("physical CAS sample no longer matches original"))
			}
			result.PhysicalCASObservedFiles = 1
			result.PhysicalCASObservedBytes = claims[0].Size
		}
		// The expensive local hash may have raced device revoke, Node edits,
		// alias changes or source configuration changes. Repeat Server proof
		// after the hashing pass; a previously passing preflight is not durable.
		again, err := cli.PreflightLocalSourceItemEvidence(
			readCtx, sourceID, source.Revision, proof,
			generation.PreviousSHA256, generation.CurrentSHA256, ids)
		if err != nil || !again.ServerConsistent ||
			again.ContentVerified || again.CommitSupported ||
			again.Authoritative || again.MissingInferenceSafe ||
			again.Checked != len(page.Items) {
			return empty, privateLocalSnapshotError(errors.New("owning Server identity changed during live hash"))
		}
		result.Checked = checked.Checked
		result.ServerConsistent = true
		result.LocallyHashedFiles = len(hashed.Digests)
		result.LocallyHashedBytes = hashed.HashedBytes
		result.CloudMetadataMatched = true
		result.MetadataMatchedFiles = metadata.Checked
	}

	// Both local inventory seals and owning credentials must remain valid
	// AFTER all network reads. This summary is never persisted or elevated.
	reloaded, err := localpush.LoadLocalReconcileEvidence(readCtx, configDir, grant, source.Revision)
	if err != nil || reloaded.IntegritySHA256 != generation.IntegritySHA256 {
		return empty, privateLocalSnapshotError(errors.New("local inventory changed during preflight"))
	}
	rulesNow, err := cli.LocalBoundRules(readCtx, sourceID, proof)
	if err != nil || rulesNow.SourceID != sourceID || rulesNow.Revision != source.Revision ||
		rulesNow.IgnoreRules != rules.IgnoreRules ||
		localBackupRuleSessionUnchanged(cfg) != nil || readCtx.Err() != nil {
		return empty, privateLocalSnapshotError(errors.New("owning authority changed during preflight"))
	}
	return result, nil
}
