package main

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

const localPhysicalReceiptRecoveryState = "sql_committed_cas_observed_native_unverified"

// historicalPhysicalReceiptMatches rejects any elevated authority even if
// another Client implementation accidentally starts returning one. A physical
// CAS observation does not attest current native bytes or backup completion.
func historicalPhysicalReceiptMatches(
	receipt client.LocalPushFirstLeafPhysicalReceipt,
	sourceID, revision uint64, stageID string,
) bool {
	return sourceID != 0 && revision != 0 && stageID != "" &&
		receipt.SourceID == sourceID && receipt.Revision == revision &&
		receipt.StageID == stageID && receipt.NodeID != 0 &&
		receipt.SourceItemID != 0 &&
		receipt.State == localPhysicalReceiptRecoveryState &&
		receipt.CASObserved && !receipt.NativeVerified &&
		!receipt.BackupComplete && !receipt.CommitSupported &&
		!receipt.Authoritative
}

func privateLocalPhysicalReceiptError(err error) error {
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	// Do not forward server errors, OS Root paths, bearer credentials, Stage
	// contents, CAS hashes or account identities to a future IPC consumer.
	return errors.New("owning device historical CAS observation unavailable")
}

// readLocalBoundBackupHistoricalPhysicalReceipt is an UNEXPORTED Agent-only,
// READ-ONLY recovery step for an uncertain private first-file SQL commit.
// It deliberately has NO IPC/Renderer/Web/startup/scheduler call site.
//
// Unlike an executor, this allows a historical committed Stage to be expired
// or replaced: the existing Server SQL+CAS physical receipt is scoped by the
// immutable Stage UUID, quarantine and quota-hold rows, not CURRENT's age.
// The Root must still be this installation's registered and verified Root,
// and the account/Source/device/revision must remain unchanged both sides of
// the network read. No fresh-native-file or native-to-CAS equality is claimed.
func (c *agentController) readLocalBoundBackupHistoricalPhysicalReceipt(
	ctx context.Context, sourceID, revision uint64, stageID, relativeLeaf string,
) (client.LocalPushFirstLeafPhysicalReceipt, error) {
	var empty client.LocalPushFirstLeafPhysicalReceipt
	if c == nil || ctx == nil || sourceID == 0 || revision == 0 ||
		stageID == "" || relativeLeaf == "" {
		return empty, privateLocalPhysicalReceiptError(errors.New("invalid recovery scope"))
	}
	if !c.localFolderGrantMu.TryLock() {
		return empty, privateLocalPhysicalReceiptError(errors.New("owning Agent recovery busy"))
	}
	defer c.localFolderGrantMu.Unlock()

	readCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	if err := readCtx.Err(); err != nil {
		return empty, privateLocalPhysicalReceiptError(err)
	}
	account, err := userconfig.Load()
	if err != nil {
		return empty, privateLocalPhysicalReceiptError(err)
	}
	source, proof, cli, err := c.localBoundBackupConfig(readCtx, sourceID)
	if err != nil || source.ID != sourceID || source.Revision != revision ||
		source.TargetNodeID == nil || *source.TargetNodeID == 0 ||
		proof.DeviceID == "" || proof.DeviceToken == "" {
		return empty, privateLocalPhysicalReceiptError(errors.New("local Source or owner changed"))
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, privateLocalPhysicalReceiptError(err)
	}
	root, err := localpush.LoadRootGrant(
		configDir, account.Server, account.Username, proof.RootID,
	)
	if err != nil || root.Server != account.Server ||
		root.Account != account.Username || root.SourceID != sourceID ||
		root.DeviceID != proof.DeviceID || root.RootID != proof.RootID ||
		root.Fingerprint != proof.RootFingerprint || !root.StrongIdentity {
		return empty, privateLocalPhysicalReceiptError(errors.New("native Root unverified"))
	}
	// Validate the exact local Root-scoped file claim without opening or
	// reading its potentially changed CURRENT native contents. A historical
	// CAS/SQL receipt must NOT require an old temporary Stage or old journal.
	if _, err := localpush.LocalInventoryPathKey(root, "file", relativeLeaf); err != nil {
		return empty, privateLocalPhysicalReceiptError(err)
	}

	receipt, err := cli.ReadLocalPushFirstLeafPhysicalReceipt(
		readCtx, sourceID, revision, proof, stageID, relativeLeaf,
	)
	if err != nil || !historicalPhysicalReceiptMatches(receipt, sourceID, revision, stageID) {
		return empty, privateLocalPhysicalReceiptError(errors.New("historical physical receipt unavailable"))
	}
	// The Server transaction fenced credential revocation and CAS lifetime.
	// This second local/remote fence also rejects an account switch, device
	// rebind, Root replacement or Source retarget racing the network call.
	nowRoot, err := localpush.LoadRootGrant(
		configDir, account.Server, account.Username, proof.RootID,
	)
	if err != nil || nowRoot != root {
		return empty, privateLocalPhysicalReceiptError(errors.New("local Root changed during read"))
	}
	if err := localBackupRuleSessionUnchanged(account); err != nil || readCtx.Err() != nil {
		return empty, privateLocalPhysicalReceiptError(errors.New("account switched during recovery"))
	}
	nowSource, nowProof, _, err := c.localBoundBackupConfig(readCtx, sourceID)
	if err != nil || nowProof != proof || nowSource.ID != source.ID ||
		nowSource.Revision != revision || nowSource.TargetNodeID == nil ||
		*nowSource.TargetNodeID != *source.TargetNodeID ||
		nowSource.SyncMode != source.SyncMode ||
		nowSource.Status != source.Status || readCtx.Err() != nil {
		return empty, privateLocalPhysicalReceiptError(errors.New("bound Source changed during read"))
	}
	// Does not mark SourceItem synced, start SourceRun, change CAS references,
	// schedule a backup, delete a file or permit the user to execute Push.
	return receipt, nil
}
