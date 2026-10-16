package main

import (
	"context"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// A private point-in-time diagnostic, NEVER a native-to-CAS atomic commit
// witness or a completed backup. All fields stay outside IPC/JSON.
type localStageNativeCASRead struct {
	StageID         string `json:"-"`
	SourceID        uint64 `json:"-"`
	Revision        uint64 `json:"-"`
	RelativePath    string `json:"-"`
	NodeID          uint64 `json:"-"`
	SourceItemID    uint64 `json:"-"`
	State           string `json:"-"`
	NativeObserved  bool   `json:"-"`
	CASObserved     bool   `json:"-"`
	BackupComplete  bool   `json:"-"`
	CommitSupported bool   `json:"-"`
	Authoritative   bool   `json:"-"`
}

const localStageNativeCASReadState = "native_current_cas_observed_ephemeral"

type localStageNativeReader func(
	context.Context, localpushstage.LocalOriginalRecoveryHint,
) (localpush.LocalStagedOriginal, error)

func validLocalNativeCASDigest(digest string) bool {
	if len(digest) != 64 {
		return false
	}
	for i := 0; i < len(digest); i++ {
		ch := digest[i]
		if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') {
			return false
		}
	}
	return true
}

// observeHistoricalNativeCAS runs TWO independently verified native reads
// around one separately authenticated historical pinned-CAS/SQL observation.
// A true result has a TOCTOU gap, cannot reconstitute a prior SourceRun, and
// MUST NOT authorize a new CAS writer. Native and Server readers are injected
// only to test failure ordering, cancellation, and deny-by-default behavior.
func observeHistoricalNativeCAS(
	ctx context.Context, hint localpushstage.LocalOriginalRecoveryHint,
	sourceID, revision uint64, readNative localStageNativeReader,
	readHistorical localStageHistoricalReceiptReader,
) (localStageNativeCASRead, error) {
	var empty localStageNativeCASRead
	stage := hint.Stage
	id, err := uuid.Parse(stage.StageID)
	if ctx == nil || readNative == nil || readHistorical == nil ||
		sourceID == 0 || revision == 0 || stage.SourceID != sourceID ||
		stage.Revision != revision || err != nil || id.String() != stage.StageID ||
		stage.Size < 0 || stage.Size > 64<<20 ||
		!validLocalNativeCASDigest(stage.SHA256) ||
		!validLocalNativeCASDigest(stage.SnapshotSHA256) ||
		!validLocalNativeCASDigest(stage.CurrentPathKey) ||
		hint.RelativePath == "" || len(hint.RelativePath) > 255 ||
		strings.TrimSpace(hint.RelativePath) != hint.RelativePath ||
		hint.RelativePath == "." || hint.RelativePath == ".." ||
		strings.ContainsAny(hint.RelativePath, "/\\") {
		return empty, errors.New("invalid owning Stage native/CAS recovery scope")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	validNative := func(v localpush.LocalStagedOriginal) bool {
		return v.Size == stage.Size && v.SHA256 == stage.SHA256 &&
			v.SnapshotSHA256 == stage.SnapshotSHA256
	}
	first, err := readNative(ctx, hint)
	if err != nil || !validNative(first) {
		return empty, errors.New("current native original no longer matches Stage")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	receipt, err := readHistorical(
		ctx, sourceID, revision, stage.StageID, hint.RelativePath,
	)
	if err != nil || !historicalPhysicalReceiptMatches(
		receipt, sourceID, revision, stage.StageID,
	) {
		return empty, errors.New("historical physical CAS receipt unavailable")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	second, err := readNative(ctx, hint)
	if err != nil || !validNative(second) || second != first {
		return empty, errors.New("native original changed during historical CAS read")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return localStageNativeCASRead{
		StageID: stage.StageID, SourceID: sourceID, Revision: revision,
		RelativePath: hint.RelativePath,
		NodeID:       receipt.NodeID, SourceItemID: receipt.SourceItemID,
		State:          localStageNativeCASReadState,
		NativeObserved: true, CASObserved: true,
		BackupComplete: false, CommitSupported: false, Authoritative: false,
	}, nil
}

// inspectLocalBoundBackupHistoricalNativeCAS is ON-DEMAND and Agent-private.
// Only one known, locally persisted exact Stage hint may be inspected; there
// is NO startup, scheduler, IPC, Renderer, REST or file-mutation caller.
// The historical receipt remains read-only, and current native bytes are
// independently rehashed on BOTH sides of its network/PostgreSQL CAS check.
func (c *agentController) inspectLocalBoundBackupHistoricalNativeCAS(
	ctx context.Context, sourceID uint64, stageID string,
) (localStageNativeCASRead, error) {
	var empty localStageNativeCASRead
	id, err := uuid.Parse(stageID)
	if c == nil || ctx == nil || sourceID == 0 || err != nil ||
		id.String() != stageID {
		return empty, privateLocalPhysicalReceiptError(errors.New("invalid private native/CAS Stage request"))
	}
	readCtx, cancel := context.WithTimeout(ctx, 150*time.Second)
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
		return empty, privateLocalPhysicalReceiptError(errors.New("owning native backup Source unavailable"))
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
		return empty, privateLocalPhysicalReceiptError(errors.New("owning native Root unavailable"))
	}
	hint, err := localpushstage.ReadLocalOriginalRecoveryHint(
		readCtx, configDir, grant, stageID,
	)
	if err != nil || hint.Stage.SourceID != sourceID ||
		hint.Stage.Revision != source.Revision || hint.Stage.StageID != stageID {
		return empty, privateLocalPhysicalReceiptError(errors.New("untrusted persisted Stage hint"))
	}
	key, err := localpush.LocalInventoryPathKey(grant, "file", hint.RelativePath)
	if err != nil || key != hint.Stage.CurrentPathKey {
		return empty, privateLocalPhysicalReceiptError(errors.New("native Stage path changed"))
	}
	readNative := func(ctx context.Context, saved localpushstage.LocalOriginalRecoveryHint) (
		localpush.LocalStagedOriginal, error,
	) {
		return localpush.StreamCurrentInventoryFileToStaging(
			ctx, configDir, grant, saved.Stage.SnapshotSHA256,
			saved.RelativePath, saved.Stage.SHA256, io.Discard, nil,
		)
	}
	observation, err := observeHistoricalNativeCAS(
		readCtx, hint, sourceID, source.Revision, readNative,
		func(ctx context.Context, id, rev uint64, stageID, leaf string) (
			client.LocalPushFirstLeafPhysicalReceipt, error,
		) {
			// Own Agent reads ALWAYS recheck current registered credential,
			// native Root, Owner and Source revision before and after HTTP.
			return c.readLocalBoundBackupHistoricalPhysicalReceipt(
				ctx, id, rev, stageID, leaf,
			)
		},
	)
	if err != nil {
		return empty, privateLocalPhysicalReceiptError(err)
	}
	latest, err := localpushstage.ReadLocalOriginalRecoveryHint(
		readCtx, configDir, grant, stageID,
	)
	if err != nil || latest.Stage != hint.Stage ||
		latest.RelativePath != hint.RelativePath ||
		!latest.CreatedAt.Equal(hint.CreatedAt) {
		return empty, privateLocalPhysicalReceiptError(errors.New("historical Stage record changed"))
	}
	latestRoot, err := localpush.LoadRootGrant(
		configDir, account.Server, account.Username, proof.RootID,
	)
	if err != nil || latestRoot != grant ||
		localBackupRuleSessionUnchanged(account) != nil {
		return empty, privateLocalPhysicalReceiptError(errors.New("owning Root or account changed"))
	}
	after, afterProof, _, err := c.localBoundBackupConfig(readCtx, sourceID)
	if err != nil || afterProof != proof ||
		after.ID != source.ID || after.Revision != source.Revision ||
		after.Status != source.Status || after.SyncMode != source.SyncMode ||
		after.TargetNodeID == nil || *after.TargetNodeID != *source.TargetNodeID ||
		readCtx.Err() != nil {
		return empty, privateLocalPhysicalReceiptError(errors.New("owning Source changed"))
	}
	// Even this two-sided read is ephemeral: CAS and native bytes are not
	// transactionally pinned together. This is NOT a safe commit token.
	return observation, nil
}
