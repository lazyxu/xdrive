package api

import (
	"bytes"
	"context"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

// The existing #2354 fixture uses a deliberately SYNTHETIC native witness.
// These tests validate only private durable SQL+physical CAS replay, never
// remote Agent attestation or production backup completion.
func TestLocalPushOriginalPhysicalTerminalReplayPinnedLocalCAS(t *testing.T) {
	f, key, op, first := makeLocalPushCommittedHistoricalOperationFixture(t)
	read := func(requestKey []byte, operationID, stageID string, generation uint64) (meta.LocalPushFileTerminal, error) {
		return f.server.readBoundLocalPushOriginalPhysicalTerminalPinned(
			f.ctx, f.source.ID, f.source.Revision, stageID, requestKey,
			operationID, generation)
	}
	if got, err := read(key, op.ID, f.stage.StageID, op.Generation); err == nil ||
		got.OperationID != "" {
		t.Fatalf("missing terminal was mistaken for a committed file: %+v %v", got, err)
	}

	var committed meta.LocalPushFirstLeafOperationCommit
	if err := f.server.DB.Where("operation_id = ?", op.ID).
		Take(&committed).Error; err != nil {
		t.Fatal(err)
	}
	witness := testLocalPushHeldNativeCommitWitness(committed)
	selector := &localPushHistoricalOperationPhysicalSelector{
		requestKey:  append([]byte(nil), key...),
		operationID: op.ID, generation: op.Generation,
		requireFileTerminalVacant: true,
	}
	if _, err := f.server.observeBoundLocalPushPhysicalCommitWithHeldNative(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, selector, witness,
	); err != nil {
		t.Fatalf("test-only terminal setup unavailable: %v", err)
	}
	for i := 0; i < 2; i++ {
		got, err := read(key, op.ID, f.stage.StageID, op.Generation)
		if err != nil || got.State != meta.LocalPushFileTerminalPhysicalCommit ||
			got.OperationID != op.ID || got.Generation != op.Generation ||
			got.StageID != f.stage.StageID ||
			got.NodeID != first.NodeID || got.SourceItemID != first.SourceItemID ||
			got.NativeWitnessSHA256 != witness.nativeWitnessSHA256 {
			t.Fatalf("historical immutable COMMIT replay %d failed: %+v %v", i, got, err)
		}
	}
	var count, runs int64
	if err := f.server.DB.Model(&meta.LocalPushFileTerminal{}).
		Where("source_id = ?", f.source.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("readback modified immutable terminal count: %d %v", count, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("readback fabricated SourceRun: %d %v", runs, err)
	}
}

func TestLocalPushOriginalPhysicalTerminalReplayRejectsWrongScopeAndMissingCAS(t *testing.T) {
	f, key, op, _ := makeLocalPushCommittedHistoricalOperationFixture(t)
	var committed meta.LocalPushFirstLeafOperationCommit
	if err := f.server.DB.Where("operation_id = ?", op.ID).
		Take(&committed).Error; err != nil {
		t.Fatal(err)
	}
	witness := testLocalPushHeldNativeCommitWitness(committed)
	selector := &localPushHistoricalOperationPhysicalSelector{
		requestKey:  append([]byte(nil), key...),
		operationID: op.ID, generation: op.Generation,
		requireFileTerminalVacant: true,
	}
	if _, err := f.server.observeBoundLocalPushPhysicalCommitWithHeldNative(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, selector, witness,
	); err != nil {
		t.Fatalf("test-only terminal setup unavailable: %v", err)
	}

	badKey := bytes.Repeat([]byte{0xb3}, localPushOperationRequestKeySize)
	for name, test := range map[string]struct {
		key        []byte
		operation  string
		stage      string
		generation uint64
	}{
		"wrong-key":        {badKey, op.ID, f.stage.StageID, op.Generation},
		"wrong-operation":  {key, "not-an-original-operation", f.stage.StageID, op.Generation},
		"wrong-stage":      {key, op.ID, "not-original-stage", op.Generation},
		"wrong-generation": {key, op.ID, f.stage.StageID, op.Generation + 1},
	} {
		t.Run(name, func(t *testing.T) {
			got, err := f.server.readBoundLocalPushOriginalPhysicalTerminalPinned(
				f.ctx, f.source.ID, f.source.Revision, test.stage,
				test.key, test.operation, test.generation)
			if err == nil || got.OperationID != "" {
				t.Fatalf("invalid replay accepted: %+v %v", got, err)
			}
		})
	}
	if err := f.local.Delete(context.Background(), f.casKey); err != nil {
		t.Fatal(err)
	}
	if got, err := f.server.readBoundLocalPushOriginalPhysicalTerminalPinned(
		f.ctx, f.source.ID, f.source.Revision, f.stage.StageID,
		key, op.ID, op.Generation,
	); err == nil || got.OperationID != "" {
		t.Fatalf("missing physical CAS became a successful replay: %+v %v", got, err)
	}
	var count int64
	if err := f.server.DB.Model(&meta.LocalPushFileTerminal{}).
		Where("source_id = ?", f.source.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("negative replay mutated history: %d %v", count, err)
	}
}
