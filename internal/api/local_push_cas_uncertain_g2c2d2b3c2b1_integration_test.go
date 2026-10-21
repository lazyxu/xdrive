package api

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

func TestOriginalCASCandidatePrecommitErrorScope(t *testing.T) {
	secret := errors.New("PRIVATE original filesystem error")
	cases := []struct {
		name      string
		err       error
		busy      bool
		uncertain bool
	}{
		{"before-callback-busy", errors.Join(storage.ErrLocalPushCASPrecommitBusy, secret), true, false},
		{"after-callback-uncertain", errors.Join(storage.ErrLocalPushCASPrecommitOutcomeUncertain, secret), false, true},
		{"generic-denial", secret, false, false},
		{"missing-denial", nil, false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := localPushOriginalCASPrecommitError(tc.err)
			if !errors.Is(got, errLocalPushOperationIntentDenied) ||
				errors.Is(got, storage.ErrLocalPushCASPrecommitBusy) != tc.busy ||
				errors.Is(got, storage.ErrLocalPushCASPrecommitOutcomeUncertain) != tc.uncertain ||
				errors.Is(got, secret) || strings.Contains(got.Error(), "PRIVATE") {
				t.Fatalf("unsafe private precommit error: %v", got)
			}
		})
	}
}

// The original SQL transaction genuinely commits a read-only receipt while
// holding the actual physical CAS shard and file descriptor. The callback
// then loses its ACK. This must remain UNCERTAIN and create no file terminal.
func TestLocalPushOriginalCASPinnedReadLostSQLAckIsUncertain(t *testing.T) {
	f, key, op, first := makeLocalPushCommittedHistoricalOperationFixture(t)
	lost := errors.New("PRIVATE SQL acknowledgement lost")
	selector := &localPushHistoricalOperationPhysicalSelector{
		requestKey:  append([]byte(nil), key...),
		operationID: op.ID, generation: op.Generation,
		requireFileTerminalVacant: true,
	}
	calls := 0
	receipt, err := f.server.readBoundLocalPushFirstLeafReceiptWithCASInspector(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName,
		func(ctx context.Context, casKey string, size int64,
			complete func(context.Context) error,
		) (bool, error) {
			return f.local.InspectPinnedLocalPushHistoricalCASBeforeCommit(ctx, casKey, size,
				func(held context.Context) error {
					calls++
					if err := complete(held); err != nil {
						return err
					}
					return lost
				})
		}, selector,
	)
	if calls != 1 || err == nil || receipt != (localPushFirstLeafSQLReceipt{}) ||
		!errors.Is(err, storage.ErrLocalPushCASPrecommitOutcomeUncertain) ||
		!errors.Is(err, lost) {
		t.Fatalf("lost physical CAS callback ACK became a conclusive result: calls=%d receipt=%+v err=%v",
			calls, receipt, err)
	}
	masked := localPushOriginalCASPrecommitError(err)
	if !errors.Is(masked, storage.ErrLocalPushCASPrecommitOutcomeUncertain) ||
		!errors.Is(masked, errLocalPushOperationIntentDenied) ||
		errors.Is(masked, lost) || strings.Contains(masked.Error(), "PRIVATE") {
		t.Fatalf("Server lost uncertainty or leaked private cause: %v", masked)
	}
	var terminals, runs int64
	if err := f.server.DB.Model(&meta.LocalPushFileTerminal{}).
		Where("source_id = ?", f.source.ID).Count(&terminals).Error; err != nil || terminals != 0 {
		t.Fatalf("uncertain read inserted physical COMMIT/CANCEL: %d %v", terminals, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("uncertain read published SourceRun: %d %v", runs, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil {
		t.Fatalf("uncertain read marked backup complete: %+v %v", item, err)
	}
	again, err := f.server.observeBoundLocalPushHistoricalPhysicalTerminalCandidate(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, key, op.ID, op.Generation)
	if err != nil || !again.physicalCASObserved ||
		again.nodeID != first.NodeID || again.sourceItemID != first.SourceItemID {
		t.Fatalf("cannot independently re-read original durable operation and CAS: %+v %v", again, err)
	}
}
