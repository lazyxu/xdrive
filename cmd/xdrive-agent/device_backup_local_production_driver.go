package main

import (
	"context"
	"errors"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushrunner"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/localpushwriter"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// localPushFirstLeafDriver is a private owning-Agent implementation of the
// bounded first-leaf protocol. The object and its OS-held secrets MUST NEVER
// cross Agent IPC, Renderer, Web, or a generic Source scheduler boundary.
// The Server still independently authorizes every request and SQL COMMIT.
// A committed leaf remains PENDING: this driver cannot complete a backup.
type localPushFirstLeafDriver struct {
	configDir      string
	account        userconfig.Config
	api            *client.Client
	grant          localpush.RootGrant
	source         client.Source
	proof          client.LocalBoundSourceProof
	currentSession func() (userconfig.Config, error)
	readBound      localFirstDirectoryBoundReader
	scope          localpushrunner.Scope
	requestScope   localPushRequestKeyScope
	stage          localpushstage.LocalOriginalServerStage
	key            localPushPrivateRequestKey
	prepared       localPushPrivatePreparedReceipt
	bound          bool
	// The owning Desktop's real first-file path requires the same live
	// kernel-locked Writer marker during HTTP SQL/CAS COMMIT and readback.
	// Internal historical read tests are not given upload authority by this.
	liveWriter         *localpushwriter.Claim
	liveWriterRequired bool
}

var errLocalPushDriverDenied = errors.New("owning local first-file runner unavailable")

func localPushFirstLeafNameValid(name string) bool {
	return name != "" && len(name) <= 255 && name != "." && name != ".." &&
		strings.TrimSpace(name) == name && !strings.ContainsAny(name, "/\\\x00\r\n")
}

func (d *localPushFirstLeafDriver) Check(ctx context.Context, s localpushrunner.Scope) error {
	if d == nil || ctx == nil || ctx.Err() != nil || d.api == nil || d.readBound == nil ||
		d.currentSession == nil || d.configDir == "" || s != d.scope ||
		!localPushFirstLeafNameValid(s.RelativePath) ||
		s.Server != d.account.Server || s.Account != d.account.Username ||
		s.SessionID != d.account.SessionID || d.account.SessionInvalid ||
		s.DeviceID != d.proof.DeviceID || s.RootID != d.proof.RootID ||
		s.RootFingerprint != d.proof.RootFingerprint ||
		s.SourceID != d.grant.SourceID || s.Revision != d.source.Revision ||
		d.source.SyncMode != meta.SourceSyncModeBackup ||
		d.source.TargetNodeID == nil || *d.source.TargetNodeID != s.TargetNodeID ||
		!validBoundFirstDirectorySource(d.source, d.proof, s.SourceID) {
		return errLocalPushDriverDenied
	}
	// Fail closed before any Server read, native scan or Stage reservation if
	// another Agent lifetime left an ambiguous or committed request behind.
	// The request slot intentionally survives session/revision/Root changes.
	expectedRequestScope := localPushRequestKeyScope{
		server: s.Server, account: s.Account, sessionID: s.SessionID,
		deviceID: s.DeviceID, rootID: s.RootID, rootFingerprint: s.RootFingerprint,
		sourceID: s.SourceID, revision: s.Revision, targetNodeID: s.TargetNodeID,
	}
	if d.requestScope != expectedRequestScope {
		return errLocalPushDriverDenied
	}
	if d.key.bytes == [32]byte{} {
		if requireFreshLocalPushOperationSlot(d.configDir, d.requestScope) != nil {
			return errLocalPushDriverDenied
		}
	} else {
		// Once THIS instance has minted its one key, the exact original OS
		// secret+claim must survive every recheck, including after COMMIT.
		// A missing/mismatched key cannot authorize a new generation.
		stored, loadErr := loadLocalPushOperationRequestKey(d.configDir, d.requestScope)
		if loadErr != nil || stored != d.key {
			return errLocalPushDriverDenied
		}
	}
	currentSession, err := d.currentSession()
	if err != nil || currentSession.SessionInvalid ||
		currentSession.Server != d.account.Server || currentSession.Username != d.account.Username ||
		currentSession.SessionID != d.account.SessionID {
		return errLocalPushDriverDenied
	}
	now, proof, err := d.readBound(ctx, s.SourceID)
	if err != nil || proof != d.proof || !validBoundFirstDirectorySource(now, proof, s.SourceID) ||
		!sameBoundFirstDirectorySource(d.source, now) || now.SyncMode != meta.SourceSyncModeBackup {
		return errLocalPushDriverDenied
	}
	root, err := localpush.LoadRootGrant(d.configDir, d.account.Server, d.account.Username, d.grant.RootID)
	if err != nil || root != d.grant || !root.StrongIdentity ||
		root.SourceID != s.SourceID || root.DeviceID != s.DeviceID ||
		root.RootID != s.RootID || root.Fingerprint != s.RootFingerprint {
		return errLocalPushDriverDenied
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return nil
}

func (d *localPushFirstLeafDriver) Stage(ctx context.Context, s localpushrunner.Scope) (localpushrunner.Staged, error) {
	var empty localpushrunner.Staged
	if err := d.Check(ctx, s); err != nil {
		return empty, err
	}
	// A newly constructed owning Agent must durably claim this Source's
	// first Stage slot BEFORE opening or transmitting original bytes.
	// Crash, lost HTTP ACK and ambiguous Stage remain quarantined.
	// The admission helper may create an O_EXCL Stage claim before it fails.
	// Every failure FROM this attempted reservation onward is uncertain:
	// absence of an ACK does not prove no Stage or HTTP bytes exist.
	if err := reserveFreshLocalPushStageAdmission(ctx, d.configDir, d.requestScope, d.grant); err != nil {
		return empty, errors.Join(localpushrunner.ErrStageAdmissionUncertain, errLocalPushDriverDenied)
	}
	staged, err := localpushstage.StageVerifiedNativeOriginalBytes(d.api, ctx, d.configDir, d.grant,
		s.Revision, d.proof, s.RelativePath, s.ContentSHA256)
	if err != nil || staged.SourceID != s.SourceID || staged.Revision != s.Revision ||
		staged.Size != s.Size || staged.SHA256 != s.ContentSHA256 ||
		staged.StageID == "" || staged.SnapshotSHA256 == "" || staged.CurrentPathKey == "" {
		return empty, errors.Join(localpushrunner.ErrStageAdmissionUncertain, errLocalPushDriverDenied)
	}
	if err := d.Check(ctx, s); err != nil {
		return empty, errors.Join(localpushrunner.ErrStageAdmissionUncertain, err)
	}
	// The stage helper has persisted an immutable, Root-bound recovery hint
	// before reporting success. Never use only an HTTP staging ACK.
	hint, err := localpushstage.ReadLocalOriginalRecoveryHint(ctx, d.configDir, d.grant, staged.StageID)
	if err != nil || hint.Stage != staged || hint.RelativePath != s.RelativePath {
		return empty, errors.Join(localpushrunner.ErrStageAdmissionUncertain, errLocalPushDriverDenied)
	}
	d.stage = staged
	return localpushrunner.Staged{StageID: staged.StageID, SourceID: s.SourceID, Revision: s.Revision,
		ContentSHA256: staged.SHA256, Size: staged.Size}, nil
}

func (d *localPushFirstLeafDriver) Prepare(ctx context.Context, s localpushrunner.Scope, st localpushrunner.Staged) (localpushrunner.Operation, error) {
	var empty localpushrunner.Operation
	if err := d.Check(ctx, s); err != nil {
		return empty, err
	}
	if st.StageID == "" || st.StageID != d.stage.StageID || st.SourceID != s.SourceID ||
		st.Revision != s.Revision || st.Size != s.Size || st.ContentSHA256 != s.ContentSHA256 ||
		d.key.bytes != [32]byte{} || d.bound {
		return empty, errLocalPushDriverDenied
	}
	// O_EXCL claim fences another Agent process. An uncertain secret-store ACK
	// keeps the claim and MUST NOT be cleared or retried with another key.
	key, err := mintLocalPushOperationRequestKey(d.configDir, d.requestScope)
	if err != nil {
		return empty, errLocalPushDriverDenied
	}
	d.key = key
	prepared, err := d.api.PrepareLocalPushOperation(ctx, s.SourceID, s.Revision, d.proof, key.bytes)
	if err != nil || prepared.SourceID != s.SourceID || prepared.Revision != s.Revision ||
		prepared.OperationID == "" || prepared.Generation == 0 || prepared.State != "reserved" {
		return empty, errLocalPushDriverDenied
	}
	// Persist the original Operation identity before the subsequent HTTP
	// binding; a crash/lost reply cannot invent a replacement generation.
	if err := persistLocalPushPreparedReceipt(d.configDir, d.requestScope, key, prepared); err != nil {
		return empty, errLocalPushDriverDenied
	}
	d.prepared = localPushPrivatePreparedReceipt{operationID: prepared.OperationID, generation: prepared.Generation}
	bind, err := d.api.BindLocalPushOperationStage(ctx, s.SourceID, s.Revision, d.proof,
		st.StageID, key.bytes, prepared.OperationID, prepared.Generation)
	if err != nil || bind.SourceID != s.SourceID || bind.Revision != s.Revision ||
		bind.StageID != st.StageID || bind.OperationID != prepared.OperationID ||
		bind.Generation != prepared.Generation {
		return empty, errLocalPushDriverDenied
	}
	if err := d.Check(ctx, s); err != nil {
		return empty, err
	}
	d.bound = true
	return localpushrunner.Operation{ID: prepared.OperationID, Generation: prepared.Generation,
		SourceID: s.SourceID, Revision: s.Revision}, nil
}

func (d *localPushFirstLeafDriver) operationMatches(s localpushrunner.Scope, st localpushrunner.Staged, op localpushrunner.Operation) bool {
	return d != nil && d.bound && d.key.bytes != [32]byte{} &&
		st.StageID == d.stage.StageID && st.SourceID == s.SourceID &&
		st.Revision == s.Revision && st.Size == s.Size && st.ContentSHA256 == s.ContentSHA256 &&
		op.ID == d.prepared.operationID && op.Generation == d.prepared.generation &&
		op.SourceID == s.SourceID && op.Revision == s.Revision
}

func (d *localPushFirstLeafDriver) nativeMatches(s localpushrunner.Scope, original localpush.NativeHeldCurrentOriginal) bool {
	return original.SourceID == s.SourceID && original.DeviceID == s.DeviceID &&
		original.RootID == s.RootID && original.RelativePath == s.RelativePath &&
		original.PathKey == d.stage.CurrentPathKey &&
		original.SnapshotSHA256 == d.stage.SnapshotSHA256 &&
		original.ContentSHA256 == s.ContentSHA256 && original.Size == s.Size && original.NativeKey != ""
}

func (d *localPushFirstLeafDriver) Commit(ctx context.Context, s localpushrunner.Scope,
	st localpushrunner.Staged, op localpushrunner.Operation) error {
	if !d.operationMatches(s, st, op) {
		return errLocalPushDriverDenied
	}
	if err := d.Check(ctx, s); err != nil {
		return err
	}
	// Pin the ORIGINAL persisted Stage recovery hint through the entire
	// native fd + live Writer Claim + authenticated HTTP CAS/SQL callback.
	// Its post-callback inode/byte/Root check must also succeed; failure
	// after HTTP may be committed remotely, so it remains UNCERTAIN.
	return d.withOriginalStageHeldDuringCommit(
		ctx, s, st, op, func(heldStageCtx context.Context) error {
			_, err := localpush.WithHeldCurrentOriginalFirstLeafCommitWindow(heldStageCtx, d.configDir, d.grant,
				d.stage.SnapshotSHA256, s.RelativePath, s.ContentSHA256, s.Size,
				func(heldCtx context.Context, original localpush.NativeHeldCurrentOriginal) error {
					if !d.nativeMatches(s, original) {
						return errLocalPushDriverDenied
					}
					if err := d.Check(heldCtx, s); err != nil {
						return err
					}
					commitBound := func(writeCtx context.Context) error {
						_, err := d.api.CommitLocalPushFirstLeafWithOperation(
							writeCtx, s.SourceID, s.Revision, d.proof, st.StageID,
							s.RelativePath, d.key.bytes, op.ID, op.Generation,
						)
						return err
					}
					if d.liveWriterRequired {
						return d.withBoundOriginalLiveWriterWitness(
							heldCtx, s, original, st, op,
							func(writeCtx context.Context, witness localPushOriginalHeldWitness) error {
								// This is Agent-local correlation, NOT a Server
								// physical terminal or remote OS attestation.
								if witness.operationID != op.ID ||
									witness.generation != op.Generation ||
									witness.stageID != st.StageID ||
									!validLocalPushNativeWitnessDigest(witness.digest) {
									return errLocalPushDriverDenied
								}
								return commitBound(writeCtx)
							},
						)
					}
					return commitBound(heldCtx)
				})
			return err
		},
	)
}

func (d *localPushFirstLeafDriver) Reconcile(ctx context.Context, s localpushrunner.Scope,
	st localpushrunner.Staged, op localpushrunner.Operation) (localpushrunner.CommitProof, error) {
	var empty localpushrunner.CommitProof
	if !d.operationMatches(s, st, op) {
		return empty, errLocalPushDriverDenied
	}
	if err := d.Check(ctx, s); err != nil {
		return empty, err
	}
	// Never infer the historical operation from a current reserved status.
	// Reopen the EXACT original OS SecretStore claim and MAC-bound operation.
	key, err := loadLocalPushOperationRequestKey(d.configDir, d.requestScope)
	if err != nil || key != d.key {
		return empty, errLocalPushDriverDenied
	}
	prepared, err := loadLocalPushPreparedReceipt(d.configDir, d.requestScope, key)
	if err != nil || prepared != d.prepared {
		return empty, errLocalPushDriverDenied
	}
	var physical client.LocalPushHistoricalOperationPhysicalReceipt
	var native localpush.NativeHeldCurrentOriginal
	hintErr := localpushstage.WithHeldLocalOriginalRecoveryHint(
		ctx, d.configDir, d.grant, st.StageID,
		func(heldHintCtx context.Context, hint localpushstage.LocalOriginalRecoveryHint) error {
			if hint.Stage != d.stage || hint.RelativePath != s.RelativePath {
				return errLocalPushDriverDenied
			}
			var cerr error
			native, cerr = localpush.WithHeldCurrentOriginalReadCheckpoint(heldHintCtx, d.configDir, d.grant,
				d.stage.SnapshotSHA256, s.RelativePath, s.ContentSHA256, s.Size,
				func(heldCtx context.Context, original localpush.NativeHeldCurrentOriginal) error {
					if !d.nativeMatches(s, original) {
						return errLocalPushDriverDenied
					}
					if err := d.Check(heldCtx, s); err != nil {
						return err
					}
					var receipt client.LocalPushHistoricalOperationPhysicalReceipt
					readBound := func(readCtx context.Context) error {
						var readErr error
						receipt, readErr = d.api.ReadLocalPushHistoricalOperationPhysicalReceipt(
							readCtx, s.SourceID, s.Revision, d.proof, st.StageID,
							s.RelativePath, key.bytes, op.ID, op.Generation,
						)
						return readErr
					}
					if d.liveWriterRequired {
						if err := d.withCurrentOriginalLiveWriterProof(
							heldCtx, s, original, readBound,
						); err != nil {
							return err
						}
					} else if err := readBound(heldCtx); err != nil {
						return err
					}
					if receipt.SourceID != s.SourceID || receipt.Revision != s.Revision ||
						receipt.StageID != st.StageID || receipt.OperationID != op.ID ||
						receipt.Generation != op.Generation || receipt.NodeID == 0 || receipt.SourceItemID == 0 ||
						!receipt.CASObserved || receipt.NativeVerified || receipt.BackupComplete ||
						receipt.Authoritative || receipt.CommitSupported || receipt.RetirementSupported {
						return errLocalPushDriverDenied
					}
					if err := d.Check(heldCtx, s); err != nil {
						return err
					}
					physical = receipt
					return heldCtx.Err()
				})
			if cerr != nil || !d.nativeMatches(s, native) {
				return errLocalPushDriverDenied
			}
			return nil
		},
	)
	if hintErr != nil || !d.nativeMatches(s, native) {
		return empty, errLocalPushDriverDenied
	}
	if err := d.Check(ctx, s); err != nil {
		return empty, err
	}
	fresh, err := loadLocalPushOperationRequestKey(d.configDir, d.requestScope)
	if err != nil || fresh != key {
		return empty, errLocalPushDriverDenied
	}
	return localpushrunner.CommitProof{StageID: st.StageID, OperationID: op.ID, Generation: op.Generation,
		SourceID: s.SourceID, Revision: s.Revision, NodeID: physical.NodeID, SourceItemID: physical.SourceItemID,
		ContentSHA256: s.ContentSHA256, Size: s.Size, DurableSQL: true, PhysicalCAS: true, NativeOriginal: true}, nil
}

// runLocalPushFirstLeafPrivate is the FIRST Agent-only opt-in executor.
// No UI, Desktop IPC, background scheduler, SourceRun or remote invocation
// calls it. The native mutex remains held across the bounded reconciliation.
// Selection is provisional and revalidated by the CURRENT journal + OS fd;
// it never authorizes choosing a different source path from Web/Renderer.
func (c *agentController) runLocalPushFirstLeafPrivate(ctx context.Context, sourceID uint64,
	relativeLeaf, contentSHA256 string, size int64) (localpushrunner.FirstLeafResult, error) {
	var empty localpushrunner.FirstLeafResult
	if c == nil || ctx == nil || sourceID == 0 || !localPushFirstLeafNameValid(relativeLeaf) ||
		!c.localFolderGrantMu.TryLock() {
		return empty, errLocalPushDriverDenied
	}
	defer c.localFolderGrantMu.Unlock()
	d, err := c.newLocalPushFirstLeafDriverPrivate(ctx, sourceID, relativeLeaf, contentSHA256, size)
	if err != nil {
		return empty, errLocalPushDriverDenied
	}
	return (&localpushrunner.Runner{}).RunFirstLeaf(ctx, d.scope, d)
}
