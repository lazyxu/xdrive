package main

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushrunner"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// newLocalPushFirstLeafDriverPrivate is called ONLY with the owning Agent's
// localFolderGrantMu held. This shared constructor keeps fresh and recovery
// Source, device, Root, target, session and Backup-mode checks identical.
func (c *agentController) newLocalPushFirstLeafDriverPrivate(ctx context.Context, sourceID uint64,
	relativeLeaf, contentSHA256 string, size int64) (*localPushFirstLeafDriver, error) {
	if c == nil || ctx == nil || ctx.Err() != nil || sourceID == 0 ||
		!localPushFirstLeafNameValid(relativeLeaf) {
		return nil, errLocalPushDriverDenied
	}
	account, err := userconfig.Load()
	if err != nil || account.Server == "" || account.Username == "" || account.SessionID == "" ||
		account.SessionInvalid {
		return nil, errLocalPushDriverDenied
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return nil, errLocalPushDriverDenied
	}
	source, proof, api, err := c.localBoundBackupConfig(ctx, sourceID)
	if err != nil || !validBoundFirstDirectorySource(source, proof, sourceID) ||
		source.SyncMode != meta.SourceSyncModeBackup || source.TargetNodeID == nil ||
		api == nil {
		return nil, errLocalPushDriverDenied
	}
	grant, err := localpush.LoadRootGrant(configDir, account.Server, account.Username, proof.RootID)
	if err != nil || !grant.StrongIdentity || grant.SourceID != sourceID ||
		grant.DeviceID != proof.DeviceID || grant.RootID != proof.RootID ||
		grant.Fingerprint != proof.RootFingerprint {
		return nil, errLocalPushDriverDenied
	}
	scope := localpushrunner.Scope{Server: account.Server, Account: account.Username, SessionID: account.SessionID,
		DeviceID: proof.DeviceID, RootID: proof.RootID, RootFingerprint: proof.RootFingerprint,
		SourceID: sourceID, Revision: source.Revision, TargetNodeID: *source.TargetNodeID,
		RelativePath: relativeLeaf, ContentSHA256: contentSHA256, Size: size}
	request := localPushRequestKeyScope{server: account.Server, account: account.Username,
		sessionID: account.SessionID, deviceID: proof.DeviceID, rootID: proof.RootID,
		rootFingerprint: proof.RootFingerprint, sourceID: sourceID, revision: source.Revision,
		targetNodeID: *source.TargetNodeID}
	d := &localPushFirstLeafDriver{configDir: configDir, account: account, api: api, grant: grant,
		source: source, proof: proof, scope: scope, requestScope: request,
		currentSession: userconfig.Load,
		readBound: func(readCtx context.Context, id uint64) (client.Source, client.LocalBoundSourceProof, error) {
			observed, gotProof, _, readErr := c.localBoundBackupConfig(readCtx, id)
			return observed, gotProof, readErr
		},
	}
	return d, nil
}

// localPushStageAdmissionClaimValidForRecovery is STRICTLY a private OS read.
// A marker is only evidence of an earlier attempt, never an upload license.
func localPushStageAdmissionClaimValidForRecovery(path string) bool {
	if !localPushStageAdmissionDirSafe(filepath.Dir(path)) {
		return false
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() ||
		info.Size() != int64(len(localPushStageAdmissionClaimContents)) ||
		(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		return false
	}
	contents, err := os.ReadFile(path)
	return err == nil && string(contents) == localPushStageAdmissionClaimContents
}

// selectLocalPushRecoveredFirstLeaf requires EXACTLY one independently
// parsed/validated local hint. Multiple, absent or cross-revision candidates
// remain quarantined; no "latest" or filename/mtime guessing is permitted.
func selectLocalPushRecoveredFirstLeaf(
	hints []localpushstage.LocalOriginalRecoveryHint, s localpushrunner.Scope,
) (localpushstage.LocalOriginalRecoveryHint, bool) {
	var empty localpushstage.LocalOriginalRecoveryHint
	if len(hints) != 1 {
		return empty, false
	}
	h := hints[0]
	if h.RelativePath != s.RelativePath || h.Stage.SourceID != s.SourceID ||
		h.Stage.Revision != s.Revision || h.Stage.Size != s.Size ||
		h.Stage.SHA256 != s.ContentSHA256 || !validLocalPushRequestUUID(h.Stage.StageID) ||
		len(h.Stage.SnapshotSHA256) != 64 || len(h.Stage.CurrentPathKey) != 64 {
		return empty, false
	}
	return h, true
}

// localPushPrivateOriginalRecoveryEvidence contains a single persisted
// previous attempt. None of its fields may enter Agent IPC or Web JSON.
// The marker and hint are evidence to inspect, never an upload license.
type localPushPrivateOriginalRecoveryEvidence struct {
	claim    string
	key      localPushPrivateRequestKey
	prepared localPushPrivatePreparedReceipt
	hint     localpushstage.LocalOriginalRecoveryHint
}

// readPriorFirstLeafOriginalEvidence is the shared, strictly local read
// admission for BOTH historical physical COMMIT and reservation-terminal
// observation. Never choose the newest hint, mint a new key, or treat an
// absent Stage hint as a safe restart after an interrupted HTTP request.
func (d *localPushFirstLeafDriver) readPriorFirstLeafOriginalEvidence(
	ctx context.Context, s localpushrunner.Scope,
) (localPushPrivateOriginalRecoveryEvidence, error) {
	var empty localPushPrivateOriginalRecoveryEvidence
	if d == nil || ctx == nil || ctx.Err() != nil || s != d.scope ||
		!localPushFirstLeafNameValid(s.RelativePath) || d.bound ||
		d.key.bytes != [32]byte{} || d.stage.StageID != "" {
		return empty, errLocalPushDriverDenied
	}
	claim, err := localPushStageAdmissionClaimPath(d.configDir, d.requestScope)
	if err != nil || !localPushStageAdmissionClaimValidForRecovery(claim) {
		return empty, errLocalPushDriverDenied
	}
	key, err := loadLocalPushOperationRequestKey(d.configDir, d.requestScope)
	if err != nil {
		return empty, errLocalPushDriverDenied
	}
	prepared, err := loadLocalPushPreparedReceipt(d.configDir, d.requestScope, key)
	if err != nil || !validLocalPushRequestUUID(prepared.operationID) ||
		prepared.generation == 0 {
		return empty, errLocalPushDriverDenied
	}
	hints, err := localpushstage.ListLocalOriginalRecoveryHints(ctx, d.configDir, d.grant)
	if err != nil {
		return empty, errLocalPushDriverDenied
	}
	hint, ok := selectLocalPushRecoveredFirstLeaf(hints, s)
	if !ok || ctx.Err() != nil {
		return empty, errLocalPushDriverDenied
	}
	return localPushPrivateOriginalRecoveryEvidence{
		claim: claim, key: key, prepared: prepared, hint: hint,
	}, nil
}

// recoverPreviousFirstLeafReadOnly runs NO Stage, Prepare, Bind or COMMIT.
// It never creates a key, clears an existing claim or changes Source state.
// The only positive result is an exact, authenticated historical SQL/CAS
// physical observation while the native original is held and post-hashed.
func (d *localPushFirstLeafDriver) recoverPreviousFirstLeafReadOnly(
	ctx context.Context, s localpushrunner.Scope,
) (localpushrunner.FirstLeafResult, error) {
	var empty localpushrunner.FirstLeafResult
	evidence, err := d.readPriorFirstLeafOriginalEvidence(ctx, s)
	if err != nil {
		return empty, errLocalPushDriverDenied
	}
	claim, key, prepared, hint := evidence.claim, evidence.key, evidence.prepared, evidence.hint
	// Rehydrate the EXACT original, never a new operation/generation.
	d.key, d.prepared, d.stage, d.bound = key, prepared, hint.Stage, true
	defer func() { d.key = localPushPrivateRequestKey{} }()
	if err := d.Check(ctx, s); err != nil {
		return empty, errLocalPushDriverDenied
	}
	st := localpushrunner.Staged{StageID: hint.Stage.StageID, SourceID: s.SourceID,
		Revision: s.Revision, ContentSHA256: s.ContentSHA256, Size: s.Size}
	op := localpushrunner.Operation{ID: prepared.operationID, Generation: prepared.generation,
		SourceID: s.SourceID, Revision: s.Revision}
	// Bounded fresh read. No background continuation after caller cancellation.
	reconcileCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	physical, err := d.Reconcile(reconcileCtx, s, st, op)
	if err != nil || !physical.DurableSQL || !physical.PhysicalCAS ||
		!physical.NativeOriginal || physical.NodeID == 0 || physical.SourceItemID == 0 ||
		physical.StageID != st.StageID || physical.OperationID != op.ID ||
		physical.Generation != op.Generation {
		return localpushrunner.FirstLeafResult{Uncertain: true}, localpushrunner.ErrUncertain
	}
	// Never claim a verified observation after local claim/hint replacement,
	// revocation or late cancellation. Still NOT a complete backup.
	after, readErr := localpushstage.ReadLocalOriginalRecoveryHint(ctx, d.configDir, d.grant, st.StageID)
	if readErr != nil || after.Stage != hint.Stage || after.RelativePath != hint.RelativePath ||
		ctx.Err() != nil || !localPushStageAdmissionClaimValidForRecovery(claim) ||
		d.Check(ctx, s) != nil ||
		d.localPushPriorEvidenceUnchanged(ctx, evidence) != nil {
		return localpushrunner.FirstLeafResult{Uncertain: true}, localpushrunner.ErrUncertain
	}
	return localpushrunner.FirstLeafResult{Confirmed: true}, nil
}

// recoverLocalPushFirstLeafPrivate is deliberately Agent-only. No Renderer,
// preload, Web, Desktop IPC, Server route, scheduler or public caller may
// invoke this. It observes an earlier original, never writes new bytes.
func (c *agentController) recoverLocalPushFirstLeafPrivate(ctx context.Context, sourceID uint64,
	relativeLeaf, contentSHA256 string, size int64) (localpushrunner.FirstLeafResult, error) {
	var empty localpushrunner.FirstLeafResult
	if c == nil || ctx == nil || ctx.Err() != nil || sourceID == 0 ||
		!localPushFirstLeafNameValid(relativeLeaf) || !c.localFolderGrantMu.TryLock() {
		return empty, errLocalPushDriverDenied
	}
	defer c.localFolderGrantMu.Unlock()
	d, err := c.newLocalPushFirstLeafDriverPrivate(ctx, sourceID, relativeLeaf, contentSHA256, size)
	if err != nil {
		return empty, errLocalPushDriverDenied
	}
	// Wrap the existing exact original SQL/CAS/native read inside the
	// historical O_EXCL Writer's held OS-lock window. This never retries.
	return d.recoverPreviousFirstLeafWithHeldWriter(ctx, d.scope)
}
