package api

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

// The internal operation-fenced writer must reject missing/forged immutable
// Stage provenance before CAS or canonical File/Node/SourceItem admission.
// No normal public Runner route is wired to this test helper.
func TestLocalPushFirstLeafRejectsMissingOrAlteredStageOperationBinding(t *testing.T) {
	for _, scenario := range []string{
		"missing-row", "changed-operation", "changed-session",
		"changed-digest", "changed-root", "changed-content",
		"changed-stage", "missing-table",
	} {
		t.Run(scenario, func(t *testing.T) {
			f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
			write := f.server.DB.Model(&meta.LocalPushOperationStageBinding{}).
				Where("stage_id = ?", f.stage.StageID)
			switch scenario {
			case "missing-row":
				if err := write.Delete(&meta.LocalPushOperationStageBinding{}).Error; err != nil {
					t.Fatal(err)
				}
			case "changed-operation":
				if err := write.Update("operation_id", uuid.NewString()).Error; err != nil {
					t.Fatal(err)
				}
			case "changed-session":
				if err := write.Update("owner_session", operation.OwnerSession+1).Error; err != nil {
					t.Fatal(err)
				}
			case "changed-digest":
				if err := write.Update("request_key_digest", strings.Repeat("f", 64)).Error; err != nil {
					t.Fatal(err)
				}
			case "changed-root":
				if err := write.Update("root_id", uuid.NewString()).Error; err != nil {
					t.Fatal(err)
				}
			case "changed-content":
				if err := write.Update("content_sha256", strings.Repeat("f", 64)).Error; err != nil {
					t.Fatal(err)
				}
			case "changed-stage":
				if err := f.server.DB.Model(&meta.LocalPushStaging{}).
					Where("stage_id = ?", f.stage.StageID).
					Update("current_snapshot_sha256", strings.Repeat("f", 64)).Error; err != nil {
					t.Fatal(err)
				}
			case "missing-table":
				if err := f.server.DB.Migrator().DropTable(&meta.LocalPushOperationStageBinding{}); err != nil {
					t.Fatal(err)
				}
			}
			got, committed, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
				f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
				localPushFirstLeafFixtureName, key, operation.ID, operation.Generation)
			if err == nil || committed || got.NodeID != 0 || got.SourceItemID != 0 {
				t.Fatalf("%s bypassed exact Stage/operation writer gate: %+v %t %v",
					scenario, got, committed, err)
			}
			var items, blobs, runs int64
			if err := f.server.DB.Model(&meta.SourceItem{}).
				Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
				t.Fatalf("%s produced SourceItem: %d %v", scenario, items, err)
			}
			if err := f.server.DB.Model(&meta.ContentBlob{}).
				Count(&blobs).Error; err != nil || blobs != 0 {
				t.Fatalf("%s retained CAS metadata: %d %v", scenario, blobs, err)
			}
			if err := f.server.DB.Model(&meta.SyncRun{}).
				Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
				t.Fatalf("%s produced SourceRun: %d %v", scenario, runs, err)
			}
		})
	}
}
