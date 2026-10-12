package main

import (
	"context"
	"errors"
	"reflect"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

const (
	localQuarantinedPhysicalPageLimit = 4
	localQuarantinedPhysicalPageBytes = int64(64 << 20)
)

// localQuarantinedPhysicalPageSummary is private ephemeral evidence only.
// It does NOT mean native bytes or cloud CAS have been durably committed.
type localQuarantinedPhysicalPageSummary struct {
	SourceID              uint64
	Revision              uint64
	Checked               int
	LocallyHashedBytes    int64
	PhysicalObservedBytes int64
	HasMore               bool
	NextAfterID           uint64
	QuarantineMatched     bool
	PhysicalCASMatched    bool
	CloudBytesVerified    bool
	ContentVerified       bool
	CommitSupported       bool
	Authoritative         bool
	MissingInferenceSafe  bool
}

// Reject any non-quarantined or newly interleaved evidence IDs. A partial
// candidate page is NOT silently used as a replacement for recovered IDs.
// Readback pagination remains separate and is the only returned cursor.
func localQuarantinedPhysicalCandidates(
	recovered client.LocalCommitIntentPage, advisory client.LocalSourceItemEvidencePage,
	sourceID, revision, afterID uint64,
) ([]uint64, []localpush.LocalEvidenceContentCandidate, error) {
	var emptyIDs []uint64
	var emptyCandidates []localpush.LocalEvidenceContentCandidate
	if sourceID == 0 || revision == 0 || recovered.SourceID != sourceID ||
		recovered.Revision != revision || recovered.EvidenceIDs == nil ||
		recovered.CommitSupported || recovered.Authoritative || recovered.MissingInferenceSafe ||
		len(recovered.EvidenceIDs) > localQuarantinedPhysicalPageLimit ||
		(recovered.HasMore && len(recovered.EvidenceIDs) != localQuarantinedPhysicalPageLimit) {
		return nil, nil, errors.New("unsafe owning quarantine content page")
	}
	prior := afterID
	for _, id := range recovered.EvidenceIDs {
		if id <= prior {
			return nil, nil, errors.New("unordered quarantined physical evidence IDs")
		}
		prior = id
	}
	if len(recovered.EvidenceIDs) == 0 {
		if recovered.HasMore || recovered.NextAfterID != 0 {
			return nil, nil, errors.New("invalid empty quarantine content cursor")
		}
		return emptyIDs, emptyCandidates, nil
	}
	if recovered.NextAfterID != prior ||
		advisory.SourceID != sourceID || advisory.Revision != revision ||
		advisory.Authoritative || advisory.MissingInferenceSafe ||
		len(advisory.Items) != len(recovered.EvidenceIDs) ||
		(advisory.HasMore && len(advisory.Items) != localQuarantinedPhysicalPageLimit) ||
		advisory.NextAfterID != recovered.NextAfterID {
		return nil, nil, errors.New("quarantined content differs from current advisory page")
	}
	ids := make([]uint64, 0, len(advisory.Items))
	candidates := make([]localpush.LocalEvidenceContentCandidate, 0, len(advisory.Items))
	items := make(map[uint64]struct{}, len(advisory.Items))
	natives := make(map[string]struct{}, len(advisory.Items))
	destinations := make(map[string]struct{}, len(advisory.Items))
	for i, item := range advisory.Items {
		if item.EvidenceID != recovered.EvidenceIDs[i] || item.SourceItemID == 0 ||
			item.PreviousPathKey == item.CurrentPathKey ||
			!validLocalQuarantineDigest(item.PreviousPathKey) ||
			!validLocalQuarantineDigest(item.CurrentPathKey) ||
			!validLocalQuarantineDigest(item.NativeIdentityKey) {
			return nil, nil, errors.New("unsafe or expanded quarantined content candidate")
		}
		if _, used := items[item.SourceItemID]; used {
			return nil, nil, errors.New("duplicate quarantine SourceItem")
		}
		if _, used := natives[item.NativeIdentityKey]; used {
			return nil, nil, errors.New("duplicate quarantine native identity")
		}
		if _, used := destinations[item.CurrentPathKey]; used {
			return nil, nil, errors.New("duplicate quarantine destination")
		}
		items[item.SourceItemID] = struct{}{}
		natives[item.NativeIdentityKey] = struct{}{}
		destinations[item.CurrentPathKey] = struct{}{}
		ids = append(ids, item.EvidenceID)
		candidates = append(candidates, localpush.LocalEvidenceContentCandidate{
			PreviousPathKey: item.PreviousPathKey, CurrentPathKey: item.CurrentPathKey,
			NativeIdentityKey: item.NativeIdentityKey,
		})
	}
	return ids, candidates, nil
}

func localQuarantinedPhysicalClaimsWithinBudget(claims []client.LocalEvidenceCloudDigest) bool {
	if len(claims) == 0 || len(claims) > localQuarantinedPhysicalPageLimit {
		return false
	}
	var previousID uint64
	var total int64
	for _, item := range claims {
		if item.EvidenceID <= previousID || item.Size < 0 ||
			item.Size > localQuarantinedPhysicalPageBytes-total ||
			!validLocalQuarantineDigest(item.SHA256) {
			return false
		}
		previousID = item.EvidenceID
		total += item.Size
	}
	return true
}

// preflightLocalBoundBackupQuarantinedPhysicalPage is intentionally private
// owning-Agent code with NO IPC/HTTP/Renderer/Web/Startup call site. It does
// not retry a quarantine write or promote any SourceItem alias. It accepts
// only a whole current bounded 1-4-record page matching already persisted
// quarantines, then rehashes real OS-backed originals before a private CAS
// content check and rechecks the evidence/Root/account after every network
// operation. Files over the physical read budget fail CLOSED.
func (c *agentController) preflightLocalBoundBackupQuarantinedPhysicalPage(
	ctx context.Context, sourceID, afterEvidenceID uint64,
) (localQuarantinedPhysicalPageSummary, error) {
	var empty localQuarantinedPhysicalPageSummary
	if ctx == nil || sourceID == 0 {
		return empty, privateLocalSnapshotError(errors.New("invalid private quarantine content request"))
	}
	if !c.localFolderGrantMu.TryLock() {
		return empty, privateLocalSnapshotError(errors.New("owning Agent content check busy"))
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
		return empty, privateLocalSnapshotError(errors.New("owning quarantine rules unavailable"))
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	grant, err := localpush.LoadRootGrant(configDir, cfg.Server, cfg.Username, proof.RootID)
	if err != nil || grant.SourceID != sourceID || grant.DeviceID != proof.DeviceID ||
		grant.RootID != proof.RootID || grant.Fingerprint != proof.RootFingerprint {
		return empty, privateLocalSnapshotError(errors.New("current native Root not authorized"))
	}
	generation, err := localpush.LoadLocalReconcileEvidence(readCtx, configDir, grant, source.Revision)
	if err != nil || generation.Authoritative || generation.MissingInferenceSafe {
		return empty, privateLocalSnapshotError(errors.New("sealed local content generations unavailable"))
	}
	before, after := generation.PreviousSHA256, generation.CurrentSHA256
	recovered, err := cli.ReadLocalSourceCommitIntentPage(
		readCtx, sourceID, source.Revision, proof, before, after,
		localQuarantinedPhysicalPageLimit, afterEvidenceID)
	if err != nil {
		return empty, privateLocalSnapshotError(errors.New("owning quarantine content read failed"))
	}
	out := localQuarantinedPhysicalPageSummary{
		SourceID: sourceID, Revision: source.Revision,
		HasMore: recovered.HasMore, NextAfterID: recovered.NextAfterID,
	}
	// Even an empty recovered page must pass all current Root and account
	// rechecks; it is NOT a successful content verification.
	var advisory client.LocalSourceItemEvidencePage
	var ids []uint64
	var candidates []localpush.LocalEvidenceContentCandidate
	if len(recovered.EvidenceIDs) == 0 {
		ids, candidates, err = localQuarantinedPhysicalCandidates(
			recovered, advisory, sourceID, source.Revision, afterEvidenceID)
	} else {
		advisory, err = cli.ReadLocalSourceItemEvidencePage(
			readCtx, sourceID, source.Revision, proof, before, after,
			localQuarantinedPhysicalPageLimit, afterEvidenceID)
		if err == nil {
			ids, candidates, err = localQuarantinedPhysicalCandidates(
				recovered, advisory, sourceID, source.Revision, afterEvidenceID)
		}
	}
	if err != nil {
		return empty, privateLocalSnapshotError(errors.New("current advisory page does not match quarantines"))
	}
	if len(ids) != 0 {
		checked, err := cli.PreflightLocalSourceItemEvidence(
			readCtx, sourceID, source.Revision, proof, before, after, ids)
		if err != nil || !checked.ServerConsistent || checked.Checked != len(ids) ||
			checked.ContentVerified || checked.CommitSupported ||
			checked.Authoritative || checked.MissingInferenceSafe {
			return empty, privateLocalSnapshotError(errors.New("current Server identity differs from quarantine"))
		}
		hashed, err := localpush.HashCurrentLocalEvidenceBatch(
			readCtx, configDir, grant, source.Revision, candidates)
		if err != nil || len(hashed.Digests) != len(ids) ||
			hashed.CloudContentVerified || hashed.Authoritative || hashed.MissingInferenceSafe {
			return empty, privateLocalSnapshotError(errors.New("original native file hash changed"))
		}
		claims := make([]client.LocalEvidenceCloudDigest, 0, len(ids))
		for i, id := range ids {
			claims = append(claims, client.LocalEvidenceCloudDigest{
				EvidenceID: id, SHA256: hashed.Digests[i].SHA256, Size: hashed.Digests[i].Size,
			})
		}
		if !localQuarantinedPhysicalClaimsWithinBudget(claims) {
			return empty, privateLocalSnapshotError(errors.New("quarantined physical page exceeds read budget"))
		}
		metadata, err := cli.CheckLocalSourceItemCloudMetadata(
			readCtx, sourceID, source.Revision, proof, before, after, claims)
		if err != nil || !metadata.CloudMetadataMatched ||
			metadata.Checked != len(claims) || metadata.CloudBytesVerified ||
			metadata.ContentVerified || metadata.CommitSupported ||
			metadata.Authoritative || metadata.MissingInferenceSafe {
			return empty, privateLocalSnapshotError(errors.New("CAS metadata no longer matches original"))
		}
		physical, err := cli.PreflightLocalQuarantinedPhysicalContentBatch(
			readCtx, sourceID, source.Revision, proof, before, after, claims)
		if err != nil || !physical.QuarantineMatched || !physical.PhysicalCASMatched ||
			physical.Checked != len(claims) || physical.CloudBytesVerified ||
			physical.ContentVerified || physical.CommitSupported ||
			physical.Authoritative || physical.MissingInferenceSafe {
			return empty, privateLocalSnapshotError(errors.New("quarantined CAS content could not be observed"))
		}
		// Confirm the *same* quarantined IDs AND private identity keys still
		// occupy the candidate page; never silently accept newly interleaved
		// or replaced evidence while hashing and reading cloud objects.
		recoveredNow, err := cli.ReadLocalSourceCommitIntentPage(
			readCtx, sourceID, source.Revision, proof, before, after,
			localQuarantinedPhysicalPageLimit, afterEvidenceID)
		if err != nil || !reflect.DeepEqual(recoveredNow, recovered) {
			return empty, privateLocalSnapshotError(errors.New("quarantine changed during physical preflight"))
		}
		advisoryNow, err := cli.ReadLocalSourceItemEvidencePage(
			readCtx, sourceID, source.Revision, proof, before, after,
			localQuarantinedPhysicalPageLimit, afterEvidenceID)
		if err != nil || !reflect.DeepEqual(advisoryNow, advisory) {
			return empty, privateLocalSnapshotError(errors.New("advisory keys changed during physical preflight"))
		}
		again, err := cli.PreflightLocalSourceItemEvidence(
			readCtx, sourceID, source.Revision, proof, before, after, ids)
		if err != nil || !again.ServerConsistent || again.Checked != len(ids) ||
			again.ContentVerified || again.CommitSupported ||
			again.Authoritative || again.MissingInferenceSafe {
			return empty, privateLocalSnapshotError(errors.New("post-read identity is no longer current"))
		}
		metadataAgain, err := cli.CheckLocalSourceItemCloudMetadata(
			readCtx, sourceID, source.Revision, proof, before, after, claims)
		if err != nil || !metadataAgain.CloudMetadataMatched ||
			metadataAgain.Checked != len(claims) || metadataAgain.CloudBytesVerified ||
			metadataAgain.ContentVerified || metadataAgain.CommitSupported ||
			metadataAgain.Authoritative || metadataAgain.MissingInferenceSafe {
			return empty, privateLocalSnapshotError(errors.New("CAS metadata changed after physical observation"))
		}
		out.Checked = len(ids)
		out.LocallyHashedBytes = hashed.HashedBytes
		out.PhysicalObservedBytes = hashed.HashedBytes
		out.QuarantineMatched = true
		out.PhysicalCASMatched = true
	}

	grantNow, err := localpush.LoadRootGrant(configDir, cfg.Server, cfg.Username, proof.RootID)
	if err != nil || grantNow != grant {
		return empty, privateLocalSnapshotError(errors.New("native Root changed during content preflight"))
	}
	generationNow, err := localpush.LoadLocalReconcileEvidence(
		readCtx, configDir, grantNow, source.Revision)
	if err != nil || generationNow.IntegritySHA256 != generation.IntegritySHA256 ||
		generationNow.PreviousSHA256 != before || generationNow.CurrentSHA256 != after {
		return empty, privateLocalSnapshotError(errors.New("sealed generation changed during content preflight"))
	}
	rulesNow, err := cli.LocalBoundRules(readCtx, sourceID, proof)
	if err != nil || rulesNow.SourceID != sourceID || rulesNow.Revision != source.Revision ||
		rulesNow.IgnoreRules != rules.IgnoreRules ||
		localBackupRuleSessionUnchanged(cfg) != nil || readCtx.Err() != nil {
		return empty, privateLocalSnapshotError(errors.New("owning Agent account or rules changed"))
	}
	sourceNow, proofNow, _, err := c.localBoundBackupConfig(readCtx, sourceID)
	if err != nil || sourceNow.ID != source.ID || sourceNow.Revision != source.Revision ||
		proofNow != proof || readCtx.Err() != nil {
		return empty, privateLocalSnapshotError(errors.New("owning device Source authorization changed"))
	}
	return out, nil
}
