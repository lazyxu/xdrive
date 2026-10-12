package main

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/client"
)

// replayLocalBoundBackupQuarantinePage is an unexported owning-Agent-only
// recovery operation for an uncertain E0b quarantine POST. It is NOT invoked
// by Agent startup, a watcher, the renderer, Desktop IPC or Web. Its result
// is still quarantined, never an identity/CAS commit or upload checkpoint.
//
// The read and write phases each repeat current device, native Root, sealed
// inventory generation, rules, account and Source revision verification.
// The E0b write phase also rehashes live originals and checks current cloud
// metadata. Critically, it MUST NOT submit a candidate that did not appear in
// the recovered E0c ID page, even when new evidence appears between phases.
// localQuarantineReplayConfirmed accepts only an exact, previously observed
// idempotent quarantine replay. Successful recovery is still non-authoritative.
func localQuarantineReplayConfirmed(
	recovered client.LocalCommitIntentPage, result localQuarantinePageSummary,
) bool {
	return recovered.SourceID != 0 && recovered.Revision != 0 &&
		len(recovered.EvidenceIDs) > 0 &&
		!recovered.CommitSupported && !recovered.Authoritative && !recovered.MissingInferenceSafe &&
		result.SourceID == recovered.SourceID &&
		result.Revision == recovered.Revision &&
		result.Quarantined == 0 && result.Replayed == len(recovered.EvidenceIDs) &&
		!result.CommitSupported && !result.Authoritative && !result.MissingInferenceSafe
}

func (c *agentController) replayLocalBoundBackupQuarantinePage(
	ctx context.Context, sourceID, afterEvidenceID uint64,
) (localQuarantinePageSummary, error) {
	var empty localQuarantinePageSummary
	if ctx == nil || sourceID == 0 {
		return empty, privateLocalSnapshotError(errors.New("invalid owning quarantine recovery"))
	}
	if err := ctx.Err(); err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	recovered, err := c.readLocalBoundBackupQuarantineRecoveryPage(
		ctx, sourceID, afterEvidenceID)
	if err != nil || validateLocalQuarantineRecoveryPage(
		recovered, sourceID, recovered.Revision, afterEvidenceID) != nil {
		return empty, privateLocalSnapshotError(errors.New("quarantine recovery read not verified"))
	}
	if err := ctx.Err(); err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	if len(recovered.EvidenceIDs) == 0 {
		// No Server write is allowed for an empty recovery page. This is not
		// evidence that a directory backup, source run or file upload finished.
		return localQuarantinePageSummary{
			SourceID: sourceID, Revision: recovered.Revision,
			CommitSupported: false, Authoritative: false, MissingInferenceSafe: false,
		}, nil
	}
	result, err := c.quarantineLocalBoundBackupEvidencePageExpected(
		ctx, sourceID, afterEvidenceID, recovered.Revision, recovered.EvidenceIDs)
	if err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	if err := ctx.Err(); err != nil {
		return empty, privateLocalSnapshotError(err)
	}
	if !localQuarantineReplayConfirmed(recovered, result) {
		// A non-idempotent result after a network ambiguity cannot be
		// classified as recovered. The quarantined database alone is never
		// a completed identity commit or a durable cloud-content proof.
		return empty, privateLocalSnapshotError(errors.New("uncertain quarantine replay; retry verified IDs"))
	}
	// Recovery pagination tracks *persisted quarantines*, not the broader
	// advisory candidate stream used to independently verify that page.
	result.HasMore = recovered.HasMore
	result.NextAfterID = recovered.NextAfterID
	return result, nil
}
