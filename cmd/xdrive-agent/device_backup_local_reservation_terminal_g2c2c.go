package main

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushrunner"
	"github.com/lazyxu/xdrive/internal/localpushstage"
)

// localPushPrivateFirstLeafReservationTerminal is a PRIVATE observation of
// an immutable Server reservation-terminal row. It is NOT a file-terminal
// receipt, physical cancellation, successful backup, or key-retirement grant.
// Unexported fields prevent Renderer/Agent IPC serialization.
type localPushPrivateFirstLeafReservationTerminal struct {
	operationID string
	generation  uint64
	state       string
	recordedAt  time.Time
}

func localPushFirstLeafReservationTerminalMatches(
	receipt client.LocalPushTerminalProof, scope localpushrunner.Scope,
	operation localPushPrivatePreparedReceipt,
) bool {
	return receipt.SourceID == scope.SourceID &&
		receipt.Revision == scope.Revision &&
		receipt.OperationID == operation.operationID &&
		receipt.Generation == operation.generation &&
		validLocalPushRequestUUID(receipt.OperationID) &&
		receipt.Generation != 0 &&
		(receipt.State == "aborted" || receipt.State == "expired") &&
		!receipt.RecordedAt.IsZero() && receipt.RecordedAt.Location() == time.UTC
}

// localPushPriorEvidenceUnchanged reopens only ORIGINAL durable private
// evidence. No missing/corrupt record is interpreted as a safe canceled file;
// never delete or replace any Stage, request key, correlation, or Root claim.
func (d *localPushFirstLeafDriver) localPushPriorEvidenceUnchanged(
	ctx context.Context, evidence localPushPrivateOriginalRecoveryEvidence,
) error {
	if d == nil || ctx == nil || ctx.Err() != nil ||
		!localPushStageAdmissionClaimValidForRecovery(evidence.claim) {
		return errLocalPushDriverDenied
	}
	savedKey, err := loadLocalPushOperationRequestKey(d.configDir, d.requestScope)
	if err != nil || savedKey != evidence.key {
		return errLocalPushDriverDenied
	}
	savedPrepared, err := loadLocalPushPreparedReceipt(
		d.configDir, d.requestScope, evidence.key)
	if err != nil || savedPrepared != evidence.prepared {
		return errLocalPushDriverDenied
	}
	savedHint, err := localpushstage.ReadLocalOriginalRecoveryHint(
		ctx, d.configDir, d.grant, evidence.hint.Stage.StageID)
	if err != nil || savedHint.Stage != evidence.hint.Stage ||
		savedHint.RelativePath != evidence.hint.RelativePath {
		return errLocalPushDriverDenied
	}
	// A second Stage may have appeared while the Server was answering.
	// Never allow the selected hint to mask a concurrently added
	// ambiguous history, even if that earlier hint stayed unchanged.
	current, err := localpushstage.ListLocalOriginalRecoveryHints(ctx, d.configDir, d.grant)
	if err != nil || len(current) != 1 ||
		current[0].Stage != evidence.hint.Stage ||
		current[0].RelativePath != evidence.hint.RelativePath {
		return errLocalPushDriverDenied
	}
	return ctx.Err()
}

// inspectPreviousFirstLeafReservationTerminalPrivate is a narrow owning
// Agent-only lookup of the EXACT OLD Stage + OS key + prepared operation.
// The Server may MATERIALIZE an immutable SQL reservation terminal row when
// its admission has genuinely aborted/expired; this is not a read-only SQL
// operation. It performs NO new byte Stage, prepare, bind, file COMMIT,
// file cancellation, SourceRun, or credential/claim retirement.
//
// The historical native original fd stays held across the authenticated
// Server lookup and is hashed again afterwards. A successful result means
// ONLY that the Server reservation ended, NOT that physical writes stopped.
func (d *localPushFirstLeafDriver) inspectPreviousFirstLeafReservationTerminalPrivate(
	ctx context.Context, s localpushrunner.Scope,
) (localPushPrivateFirstLeafReservationTerminal, error) {
	var empty localPushPrivateFirstLeafReservationTerminal
	evidence, err := d.readPriorFirstLeafOriginalEvidence(ctx, s)
	if err != nil {
		return empty, errLocalPushDriverDenied
	}
	d.key, d.prepared, d.stage, d.bound =
		evidence.key, evidence.prepared, evidence.hint.Stage, true
	defer func() {
		d.key = localPushPrivateRequestKey{}
		d.prepared = localPushPrivatePreparedReceipt{}
		d.stage = localpushstage.LocalOriginalServerStage{}
		d.bound = false
	}()
	if d.Check(ctx, s) != nil || d.localPushPriorEvidenceUnchanged(ctx, evidence) != nil {
		return empty, errLocalPushDriverDenied
	}
	workCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var observed client.LocalPushTerminalProof
	native, err := localpush.WithHeldCurrentOriginalReadCheckpoint(
		workCtx, d.configDir, d.grant, evidence.hint.Stage.SnapshotSHA256,
		s.RelativePath, s.ContentSHA256, s.Size,
		func(heldCtx context.Context, original localpush.NativeHeldCurrentOriginal) error {
			if !d.nativeMatches(s, original) ||
				d.Check(heldCtx, s) != nil ||
				d.localPushPriorEvidenceUnchanged(heldCtx, evidence) != nil {
				return errLocalPushDriverDenied
			}
			// This POST can create ONLY a reservation-terminal SQL witness.
			// It is never a file-terminal receipt or an upload/cancel action.
			got, readErr := d.api.ReadLocalPushTerminalProof(
				heldCtx, s.SourceID, s.Revision, d.proof,
				evidence.key.bytes, evidence.prepared.operationID,
				evidence.prepared.generation)
			if readErr != nil || !localPushFirstLeafReservationTerminalMatches(
				got, s, evidence.prepared) ||
				d.Check(heldCtx, s) != nil ||
				d.localPushPriorEvidenceUnchanged(heldCtx, evidence) != nil {
				return errLocalPushDriverDenied
			}
			observed = got
			return heldCtx.Err()
		},
	)
	if err != nil || !d.nativeMatches(s, native) ||
		!localPushFirstLeafReservationTerminalMatches(observed, s, evidence.prepared) ||
		d.Check(ctx, s) != nil ||
		d.localPushPriorEvidenceUnchanged(ctx, evidence) != nil {
		return empty, errLocalPushDriverDenied
	}
	return localPushPrivateFirstLeafReservationTerminal{
		operationID: observed.OperationID,
		generation:  observed.Generation,
		state:       observed.State,
		recordedAt:  observed.RecordedAt,
	}, nil
}

// inspectLocalPushFirstLeafReservationTerminalPrivate is intentionally NOT
// registered on Server, Desktop IPC, Electron Main/Preload, or Web. Only the
// owning xdrive-agent has local native Root and private OS credential access.
func (c *agentController) inspectLocalPushFirstLeafReservationTerminalPrivate(
	ctx context.Context, sourceID uint64,
	relativeLeaf, contentSHA256 string, size int64,
) (localPushPrivateFirstLeafReservationTerminal, error) {
	var empty localPushPrivateFirstLeafReservationTerminal
	if c == nil || ctx == nil || ctx.Err() != nil || sourceID == 0 ||
		!localPushFirstLeafNameValid(relativeLeaf) ||
		!c.localFolderGrantMu.TryLock() {
		return empty, errLocalPushDriverDenied
	}
	defer c.localFolderGrantMu.Unlock()
	d, err := c.newLocalPushFirstLeafDriverPrivate(
		ctx, sourceID, relativeLeaf, contentSHA256, size)
	if err != nil {
		return empty, errLocalPushDriverDenied
	}
	return d.inspectPreviousFirstLeafReservationTerminalPrivate(ctx, d.scope)
}
