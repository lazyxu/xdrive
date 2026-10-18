package api

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

// Exercise ACTUAL Local storage CAS pins and PostgreSQL committed first-leaf
// rows, not a mock inspector or owner-JWT-only Source query.
func makeLocalPushCommittedHistoricalOperationFixture(
	t *testing.T,
) (localPushExistingCASTestFixture, []byte, meta.LocalPushOperationIntent, localPushFirstFileCommitResult) {
	t.Helper()
	f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
	first, committed, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, key, operation.ID, operation.Generation,
	)
	if err != nil || !committed || first.NodeID == 0 || first.SourceItemID == 0 ||
		first.Replayed {
		t.Fatalf("real original current-operation first-leaf SQL commit unavailable: %+v admitted=%t %v",
			first, committed, err)
	}
	return f, key, operation, first
}

func TestLocalPushHistoricalOperationPhysicalReadIsExactAndStillNonAuthoritative(t *testing.T) {
	f, key, operation, first := makeLocalPushCommittedHistoricalOperationFixture(t)
	read := func() (localPushHistoricalOperationPhysicalObservation, error) {
		return f.server.observeBoundLocalPushHistoricalOperationPhysicalCommit(
			f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
			localPushFirstLeafFixtureName, key, operation.ID, operation.Generation)
	}
	observed, err := read()
	if err != nil || !observed.casObserved ||
		observed.operationID != operation.ID ||
		observed.generation != operation.Generation ||
		observed.stageID != f.stage.StageID ||
		observed.nodeID != first.NodeID ||
		observed.sourceItemID != first.SourceItemID {
		t.Fatalf("current physical CAS and original SQL operation were not observed together: %+v %v", observed, err)
	}
	wire, err := json.Marshal(observed)
	if err != nil || string(wire) != "{}" {
		t.Fatalf("private historical observation escaped JSON: %s %v", wire, err)
	}
	// A committed first-file temporary Stage may be subsequently replaced;
	// the immutable Stage/Operation SQL and physical CAS remain historical.
	if err := f.server.DB.Model(&meta.LocalPushStaging{}).
		Where("source_id = ?", f.source.ID).
		Update("stage_id", uuid.NewString()).Error; err != nil {
		t.Fatal(err)
	}
	again, err := read()
	if err != nil || again != observed {
		t.Fatalf("Stage replacement invalidated immutable operation physical evidence: %+v %v", again, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending ||
		item.LastSyncedAt != nil || item.LastSyncedRunID != "" {
		t.Fatalf("physical observation fabricated backup completion: %+v %v", item, err)
	}
	var runCount int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runCount).Error; err != nil || runCount != 0 {
		t.Fatalf("historical operation physical observation fabricated SourceRun: %d %v", runCount, err)
	}
}

func TestLocalPushHistoricalOperationPhysicalReadRejectsWrongScopeOrCorruption(t *testing.T) {
	for _, scenario := range []string{
		"wrong-key", "wrong-operation", "wrong-generation",
		"foreign-owner", "forged-device", "wrong-root", "revoked-device",
		"source-revision", "target-removed", "commit-digest",
		"binding-snapshot", "commit-node", "pending-item", "missing-cas",
		"corrupt-cas", "missing-commit-schema",
	} {
		t.Run(scenario, func(t *testing.T) {
			f, key, operation, first := makeLocalPushCommittedHistoricalOperationFixture(t)
			id, generation := operation.ID, operation.Generation
			switch scenario {
			case "wrong-key":
				key = bytes.Repeat([]byte{0x9b}, localPushOperationRequestKeySize)
			case "wrong-operation":
				id = uuid.NewString()
			case "wrong-generation":
				generation++
			case "foreign-owner":
				f.ctx.Set("userID", f.device.OwnerID+1)
			case "forged-device":
				f.ctx.Request.Header.Set("X-XDrive-Device-Token", "foreign-private-device")
			case "wrong-root":
				f.ctx.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", strings.Repeat("f", 64))
			case "revoked-device":
				now := time.Now().UTC()
				if err := f.server.DB.Model(&meta.ClientDevice{}).
					Where("id = ?", f.device.ID).Update("revoked_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			case "source-revision":
				if err := f.server.DB.Model(&meta.Source{}).
					Where("id = ?", f.source.ID).Update("revision", f.source.Revision+1).Error; err != nil {
					t.Fatal(err)
				}
			case "target-removed":
				if err := f.server.DB.Model(&meta.Source{}).
					Where("id = ?", f.source.ID).Update("target_node_id", nil).Error; err != nil {
					t.Fatal(err)
				}
			case "commit-digest":
				if err := f.server.DB.Model(&meta.LocalPushFirstLeafOperationCommit{}).
					Where("operation_id = ?", operation.ID).
					Update("content_sha256", strings.Repeat("a", 64)).Error; err != nil {
					t.Fatal(err)
				}
			case "binding-snapshot":
				// The fixture's legitimate CURRENT snapshot already consists
				// of 64 'b' characters. A fixed 'b' overwrite is a no-op,
				// not a negative tampering test. Always change the digest.
				corruptSnapshot := strings.Repeat("d", 64)
				if corruptSnapshot == f.stage.CurrentSnapshotSHA256 {
					corruptSnapshot = strings.Repeat("e", 64)
				}
				changed := f.server.DB.Model(&meta.LocalPushOperationStageBinding{}).
					Where("stage_id = ?", f.stage.StageID).
					Update("current_snapshot_sha256", corruptSnapshot)
				if changed.Error != nil || changed.RowsAffected != 1 {
					t.Fatalf("failed to corrupt one saved Stage snapshot: rows=%d err=%v",
						changed.RowsAffected, changed.Error)
				}
			case "commit-node":
				if err := f.server.DB.Model(&meta.LocalPushFirstLeafOperationCommit{}).
					Where("operation_id = ?", operation.ID).
					Update("node_id", first.NodeID+100).Error; err != nil {
					t.Fatal(err)
				}
			case "pending-item":
				if err := f.server.DB.Model(&meta.SourceItem{}).
					Where("id = ?", first.SourceItemID).
					Update("state", meta.SourceItemStateSynced).Error; err != nil {
					t.Fatal(err)
				}
			case "missing-cas":
				if err := f.local.Delete(context.Background(), f.casKey); err != nil {
					t.Fatal(err)
				}
			case "corrupt-cas":
				file := filepath.Join(f.local.FilesystemRoot(), filepath.FromSlash(f.casKey))
				changed := bytes.Repeat([]byte{0x81}, len(f.body))
				if err := os.WriteFile(file, changed, 0o600); err != nil {
					t.Fatal(err)
				}
			case "missing-commit-schema":
				if err := f.server.DB.Migrator().
					DropTable(&meta.LocalPushFirstLeafOperationCommit{}); err != nil {
					t.Fatal(err)
				}
			}
			got, err := f.server.observeBoundLocalPushHistoricalOperationPhysicalCommit(
				f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
				localPushFirstLeafFixtureName, key, id, generation)
			if err == nil || got.casObserved || got.nodeID != 0 ||
				got.sourceItemID != 0 {
				t.Fatalf("%s improperly admitted private operation physical evidence: %+v %v",
					scenario, got, err)
			}
			var runs int64
			if err := f.server.DB.Model(&meta.SyncRun{}).
				Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
				t.Fatalf("%s published a backup Run: %d %v", scenario, runs, err)
			}
		})
	}
}
