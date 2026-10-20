package main

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/localpushrunner"
)

// This Agent-private result is NOT a durable file-terminal receipt,
// completed backup, cancellation or credential-retirement permit.
// Every member is unexported; JSON marshaling intentionally yields {}.
type localPushPriorFirstLeafOutcome struct {
	state       string
	operationID string
	generation  uint64
}

const (
	localPushPriorPhysicalCommitObserved = "physical_commit_observed_backup_pending"
	localPushPriorAbortedUnresolved      = "reservation_aborted_physical_unresolved"
	localPushPriorExpiredUnresolved      = "reservation_expired_physical_unresolved"
)

type localPushPriorPhysicalRead func(context.Context) (localpushrunner.FirstLeafResult, error)
type localPushPriorReservationRead func(context.Context) (localPushPrivateFirstLeafReservationTerminal, error)

// classifyLocalPushPriorFirstLeafPrivate NEVER infers stopped physical work
// from a Server reservation abort/expiry. A verified historical original-key
// SQL/CAS + native observation takes precedence. Only the original observer's
// precise ErrUncertain permits a second, reservation-only inspection;
// permission errors, contradictory responses and cancellations fail CLOSED.
func classifyLocalPushPriorFirstLeafPrivate(
	ctx context.Context, evidence localPushPrivateOriginalRecoveryEvidence,
	physical localPushPriorPhysicalRead, reservation localPushPriorReservationRead,
) (localPushPriorFirstLeafOutcome, error) {
	var empty localPushPriorFirstLeafOutcome
	if ctx == nil || ctx.Err() != nil || physical == nil || reservation == nil ||
		!validLocalPushRequestUUID(evidence.prepared.operationID) ||
		evidence.prepared.generation == 0 || evidence.key.bytes == [32]byte{} ||
		evidence.claim == "" || evidence.hint.Stage.StageID == "" {
		return empty, errLocalPushDriverDenied
	}
	observed, err := physical(ctx)
	if ctx.Err() != nil {
		return empty, errLocalPushDriverDenied
	}
	if err == nil && observed.Confirmed && !observed.Uncertain {
		return localPushPriorFirstLeafOutcome{
			state:       localPushPriorPhysicalCommitObserved,
			operationID: evidence.prepared.operationID,
			generation:  evidence.prepared.generation,
		}, nil
	}
	// Never downgrade an authorization failure, inconsistent positive
	// response, or arbitrary network error to a seemingly safe terminal.
	if !errors.Is(err, localpushrunner.ErrUncertain) ||
		!observed.Uncertain || observed.Confirmed {
		return empty, errLocalPushDriverDenied
	}
	if ctx.Err() != nil {
		return empty, errLocalPushDriverDenied
	}
	terminal, err := reservation(ctx)
	if err != nil || ctx.Err() != nil ||
		terminal.operationID != evidence.prepared.operationID ||
		terminal.generation != evidence.prepared.generation ||
		terminal.recordedAt.IsZero() || terminal.recordedAt.Location() != time.UTC {
		return empty, localpushrunner.ErrUncertain
	}
	state := ""
	switch terminal.state {
	case "aborted":
		state = localPushPriorAbortedUnresolved
	case "expired":
		state = localPushPriorExpiredUnresolved
	default:
		return empty, localpushrunner.ErrUncertain
	}
	return localPushPriorFirstLeafOutcome{
		state: state, operationID: terminal.operationID,
		generation: terminal.generation,
	}, nil
}

func localPushSamePriorFirstLeafEvidence(
	a, b localPushPrivateOriginalRecoveryEvidence,
) bool {
	return a.claim == b.claim && a.key == b.key && a.prepared == b.prepared &&
		a.hint.Stage == b.hint.Stage && a.hint.RelativePath == b.hint.RelativePath &&
		a.hint.CreatedAt.Equal(b.hint.CreatedAt)
}

// inspectLocalPushPriorFirstLeafOutcomePrivate remains UNROUTED and holds
// only the owning Agent's original local Root mutex. Both sub-observers
// independently reauthenticate current Server/account/session, Device
// credential, native Root/fingerprint, Source revision/target and the
// persisted original request key, MAC UUID/generation and unique Stage.
// A fresh final Agent read checks that ORIGINAL evidence remained unchanged.
//
// This sequential observation is NOT a distributed SQL/OS transaction,
// physical writer-quiescence proof, SourceRun completion or cancel lease.
// There is no new Stage, upload, key deletion, scheduler, IPC or Web caller.
func (c *agentController) inspectLocalPushPriorFirstLeafOutcomePrivate(
	ctx context.Context, sourceID uint64,
	relativeLeaf, contentSHA256 string, size int64,
) (localPushPriorFirstLeafOutcome, error) {
	var empty localPushPriorFirstLeafOutcome
	if c == nil || ctx == nil || ctx.Err() != nil || sourceID == 0 ||
		!localPushFirstLeafNameValid(relativeLeaf) ||
		size < 0 || size > localpushrunner.MaxFirstLeafBytes ||
		!c.localFolderGrantMu.TryLock() {
		return empty, errLocalPushDriverDenied
	}
	defer c.localFolderGrantMu.Unlock()

	first, err := c.newLocalPushFirstLeafDriverPrivate(
		ctx, sourceID, relativeLeaf, contentSHA256, size)
	if err != nil {
		return empty, errLocalPushDriverDenied
	}
	initial, err := first.readPriorFirstLeafOriginalEvidence(ctx, first.scope)
	if err != nil {
		return empty, errLocalPushDriverDenied
	}
	outcome, err := classifyLocalPushPriorFirstLeafPrivate(ctx, initial,
		func(readCtx context.Context) (localpushrunner.FirstLeafResult, error) {
			d, createErr := c.newLocalPushFirstLeafDriverPrivate(
				readCtx, sourceID, relativeLeaf, contentSHA256, size)
			if createErr != nil {
				return localpushrunner.FirstLeafResult{}, errLocalPushDriverDenied
			}
			return d.recoverPreviousFirstLeafReadOnly(readCtx, d.scope)
		},
		func(readCtx context.Context) (localPushPrivateFirstLeafReservationTerminal, error) {
			d, createErr := c.newLocalPushFirstLeafDriverPrivate(
				readCtx, sourceID, relativeLeaf, contentSHA256, size)
			if createErr != nil {
				return localPushPrivateFirstLeafReservationTerminal{}, errLocalPushDriverDenied
			}
			return d.inspectPreviousFirstLeafReservationTerminalPrivate(readCtx, d.scope)
		},
	)
	if err != nil || ctx.Err() != nil {
		return empty, errLocalPushDriverDenied
	}
	last, err := c.newLocalPushFirstLeafDriverPrivate(
		ctx, sourceID, relativeLeaf, contentSHA256, size)
	if err != nil {
		return empty, errLocalPushDriverDenied
	}
	finalEvidence, err := last.readPriorFirstLeafOriginalEvidence(ctx, last.scope)
	if err != nil || !localPushSamePriorFirstLeafEvidence(initial, finalEvidence) ||
		ctx.Err() != nil {
		return empty, errLocalPushDriverDenied
	}
	return outcome, nil
}
