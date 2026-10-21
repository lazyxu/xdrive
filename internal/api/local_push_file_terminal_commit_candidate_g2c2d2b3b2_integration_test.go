package api

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

// Uses the REAL committed first-leaf PostgreSQL fixture and physical Local
// CAS pins. No mock CAS observation can turn this into a terminal writer.
func TestLocalPushOriginalOperationPhysicalTerminalCandidateIsReadOnly(t *testing.T) {
	f, key, op, first := makeLocalPushCommittedHistoricalOperationFixture(t)
	candidate, err := f.server.observeBoundLocalPushHistoricalPhysicalTerminalCandidate(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, key, op.ID, op.Generation,
	)
	if err != nil || !candidate.physicalCASObserved ||
		candidate.operationID != op.ID || candidate.generation != op.Generation ||
		candidate.stageID != f.stage.StageID ||
		candidate.nodeID != first.NodeID || candidate.sourceItemID != first.SourceItemID {
		t.Fatalf("original COMMIT+CAS was not verified under exclusive operation slot: %+v %v", candidate, err)
	}
	wire, err := json.Marshal(candidate)
	if err != nil || string(wire) != "{}" {
		t.Fatalf("private candidate escaped JSON: %s %v", wire, err)
	}
	var decisions, runs int64
	if err := f.server.DB.Model(&meta.LocalPushFileTerminal{}).
		Where("source_id = ?", f.source.ID).Count(&decisions).Error; err != nil || decisions != 0 {
		t.Fatalf("read-only candidate inserted physical terminal: %d %v", decisions, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("read-only candidate created backup run: %d %v", runs, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil {
		t.Fatalf("read-only candidate completed source item: %+v %v", item, err)
	}
}

func TestLocalPushOriginalOperationPhysicalTerminalCandidateFailsClosed(t *testing.T) {
	for _, scenario := range []string{
		"wrong-key", "wrong-stage", "wrong-generation", "wrong-owner",
		"revoked-device", "missing-cas", "corrupt-cas", "existing-terminal", "missing-terminal-schema",
		"wrong-revision", "mirror-mode", "canceled",
	} {
		t.Run(scenario, func(t *testing.T) {
			f, key, op, _ := makeLocalPushCommittedHistoricalOperationFixture(t)
			stage, generation, revision := f.stage.StageID, op.Generation, f.source.Revision
			switch scenario {
			case "wrong-key":
				key = bytes.Repeat([]byte{0xe3}, localPushOperationRequestKeySize)
			case "wrong-stage":
				stage = uuid.NewString()
			case "wrong-generation":
				generation++
			case "wrong-owner":
				f.ctx.Set("userID", f.device.OwnerID+1)
			case "revoked-device":
				now := time.Now().UTC()
				if err := f.server.DB.Model(&meta.ClientDevice{}).
					Where("id = ?", f.device.ID).Update("revoked_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			case "missing-cas":
				if err := f.local.Delete(context.Background(), f.casKey); err != nil {
					t.Fatal(err)
				}
			case "corrupt-cas":
				// Genuine in-place same-size mutation of the original physical
				// CAS. This is not an HTTP mock or altered SQL digest.
				if len(f.body) == 0 {
					t.Fatal("physical CAS fixture unexpectedly empty")
				}
				altered := append([]byte(nil), f.body...)
				altered[len(altered)/2] ^= 0x40
				path := filepath.Join(f.local.FilesystemRoot(), filepath.FromSlash(f.casKey))
				if err := os.WriteFile(path, altered, 0o600); err != nil {
					t.Fatal(err)
				}
			case "existing-terminal":
				// Synthetic B1 row, TEST ONLY; no native quiescence is assumed.
				claim := testLocalPushFileTerminal(op, f.stage.StageID)
				if err := f.server.DB.Create(&claim).Error; err != nil {
					t.Fatal(err)
				}
			case "missing-terminal-schema":
				if err := f.server.DB.Migrator().DropTable(&meta.LocalPushFileTerminal{}); err != nil {
					t.Fatal(err)
				}
			case "mirror-mode":
				if err := f.server.DB.Model(&meta.Source{}).
					Where("id = ?", f.source.ID).
					Update("sync_mode", meta.SourceSyncModeMirror).Error; err != nil {
					t.Fatal(err)
				}
			case "wrong-revision":
				revision++
			case "canceled":
				ctx, cancel := context.WithCancel(f.ctx.Request.Context())
				cancel()
				f.ctx.Request = f.ctx.Request.WithContext(ctx)
			}
			candidate, err := f.server.observeBoundLocalPushHistoricalPhysicalTerminalCandidate(
				f.ctx, f.source.ID, revision, f.proof, stage,
				localPushFirstLeafFixtureName, key, op.ID, generation,
			)
			if err == nil || candidate != (localPushPhysicalTerminalCandidate{}) {
				t.Fatalf("%s admitted an unauthenticated or contradictory candidate: %+v %v",
					scenario, candidate, err)
			}
			if scenario == "corrupt-cas" {
				// A corrupt canonical blob must never be promoted by the
				// Server's retained operation UPDATE/CAS double check.
				var count int64
				if err := f.server.DB.Model(&meta.LocalPushFileTerminal{}).
					Where("source_id = ?", f.source.ID).Count(&count).Error; err != nil || count != 0 {
					t.Fatalf("corrupt CAS published a file-terminal outcome: %d %v", count, err)
				}
			}
			if scenario == "existing-terminal" {
				// Ordinary historical diagnostics do not inherit the new B3b2
				// terminal VACANCY mode or claim physical cancellation.
				prior, err := f.server.observeBoundLocalPushHistoricalOperationPhysicalCommit(
					f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
					localPushFirstLeafFixtureName, key, op.ID, op.Generation)
				if err != nil || !prior.casObserved {
					t.Fatalf("existing read-only audit was altered: %+v %v", prior, err)
				}
			}
		})
	}
}

func TestLocalPushOriginalOperationTerminalCandidateRequiresCommittedLeaf(t *testing.T) {
	f, key, op := makeLocalPushBoundFirstLeafFixture(t)
	candidate, err := f.server.observeBoundLocalPushHistoricalPhysicalTerminalCandidate(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, key, op.ID, op.Generation,
	)
	if err == nil || candidate != (localPushPhysicalTerminalCandidate{}) {
		t.Fatalf("reserved/uncommitted first leaf accepted as terminal candidate: %+v %v", candidate, err)
	}
	// Neither a reservation lease nor a synthetic digest is a native witness.
	var count int64
	if err := f.server.DB.Model(&meta.LocalPushFileTerminal{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("uncommitted candidate wrote a terminal row: %d %v", count, err)
	}
}
