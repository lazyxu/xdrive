package api

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

// A physically staged first-file candidate and an independently reserved
// operation may be durably correlated in Server SQL. The correlation is never
// an Agent native descriptor or a successful canonical upload.
func TestLocalPushStageOperationBindingExactReplayAndNoAuthority(t *testing.T) {
	f, key, operation := makeLocalPushFencedFirstLeafFixture(t)
	if err := f.server.DB.AutoMigrate(&meta.LocalPushOperationStageBinding{}); err != nil {
		t.Fatal(err)
	}
	var nodesBefore, itemsBefore, runsBefore int64
	if err := f.server.DB.Model(&meta.Node{}).Count(&nodesBefore).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).Count(&itemsBefore).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).Count(&runsBefore).Error; err != nil {
		t.Fatal(err)
	}
	bind := func() (meta.LocalPushOperationStageBinding, error) {
		return f.server.bindBoundLocalPushOperationStage(
			f.ctx, f.source.ID, f.source.Revision, f.proof,
			f.stage.StageID, key, operation.ID, operation.Generation)
	}
	first, err := bind()
	if err != nil || first.StageID != f.stage.StageID ||
		first.OperationID != operation.ID || first.Generation != operation.Generation ||
		first.RequestKeyDigest == "" || first.CurrentPathKey != f.stage.CurrentPathKey ||
		first.ContentSHA256 != f.stage.ContentSHA256 ||
		first.CurrentSnapshotSHA256 != f.stage.CurrentSnapshotSHA256 ||
		first.OwnerSession != operation.OwnerSession ||
		first.TotalSize != f.stage.TotalSize || first.BoundAt.IsZero() {
		t.Fatalf("private stage-operation correlation missing: %+v %v", first, err)
	}
	second, err := bind()
	if err != nil || !sameLocalPushStageOperationIdentity(first, second) ||
		!first.BoundAt.Equal(second.BoundAt) {
		t.Fatalf("idempotent same-operation replay changed binding: %+v %v", second, err)
	}
	var count int64
	if err := f.server.DB.Model(&meta.LocalPushOperationStageBinding{}).
		Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("immutable binding was duplicated: %d %v", count, err)
	}
	wire, err := json.Marshal(first)
	if err != nil || string(wire) != "{}" {
		t.Fatalf("private Stage binding leaked JSON: %s %v", wire, err)
	}
	var n, i, r int64
	if err := f.server.DB.Model(&meta.Node{}).Count(&n).Error; err != nil || n != nodesBefore {
		t.Fatalf("binding wrote Node: %d %v", n, err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).Count(&i).Error; err != nil || i != itemsBefore {
		t.Fatalf("binding wrote SourceItem: %d %v", i, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).Count(&r).Error; err != nil || r != runsBefore {
		t.Fatalf("binding fabricated SourceRun: %d %v", r, err)
	}
	var stage meta.LocalPushStaging
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&stage).Error; err != nil ||
		stage.Status != localPushStageReady {
		t.Fatalf("binding activated Stage or backup: %+v %v", stage, err)
	}
}

func TestLocalPushStageOperationBindingFailsClosedOnScopeAndState(t *testing.T) {
	for _, scenario := range []string{
		"wrong-key", "nil-key", "wrong-operation", "wrong-generation",
		"missing-stage", "stage-canceled", "stage-content-drift",
		"expired", "aborted", "terminal-present", "revoked-device",
		"foreign-owner", "wrong-root", "revised-source", "canceled-context",
		"missing-migration",
	} {
		t.Run(scenario, func(t *testing.T) {
			f, key, operation := makeLocalPushFencedFirstLeafFixture(t)
			if scenario != "missing-migration" {
				if err := f.server.DB.AutoMigrate(&meta.LocalPushOperationStageBinding{}); err != nil {
					t.Fatal(err)
				}
			}
			c := f.ctx
			stageID, operationID, generation := f.stage.StageID, operation.ID, operation.Generation
			switch scenario {
			case "wrong-key":
				key = bytes.Repeat([]byte{0x8a}, localPushOperationRequestKeySize)
			case "nil-key":
				key = nil
			case "wrong-operation":
				operationID = uuid.NewString()
			case "wrong-generation":
				generation++
			case "missing-stage":
				stageID = uuid.NewString()
			case "stage-canceled":
				if err := f.server.DB.Model(&meta.LocalPushStaging{}).
					Where("stage_id = ?", stageID).
					Update("status", localPushStageCanceled).Error; err != nil {
					t.Fatal(err)
				}
			case "stage-content-drift":
				if err := f.server.DB.Model(&meta.LocalPushStaging{}).
					Where("stage_id = ?", stageID).
					Update("content_sha256", strings.Repeat("f", 64)).Error; err != nil {
					t.Fatal(err)
				}
			case "expired":
				if err := f.server.DB.Model(&meta.LocalPushOperationIntent{}).
					Where("id = ?", operation.ID).
					Update("expires_at", time.Now().UTC().Add(-time.Second)).Error; err != nil {
					t.Fatal(err)
				}
			case "aborted":
				if err := f.server.abortBoundLocalPushOperationIntent(
					f.ctx, f.source.ID, f.source.Revision, operation.ID, operation.Generation); err != nil {
					t.Fatal(err)
				}
			case "terminal-present":
				digest, valid := localPushOperationRequestKeyDigest(key)
				if !valid {
					t.Fatal("original key missing")
				}
				if err := f.server.DB.Create(&meta.LocalPushOperationTerminalReceipt{
					OperationID: operation.ID, SourceID: f.source.ID,
					Generation: operation.Generation, RequestKeyDigest: digest,
					State:      meta.LocalPushTerminalReservationExpired,
					RecordedAt: time.Now().UTC(),
				}).Error; err != nil {
					t.Fatal(err)
				}
			case "revoked-device":
				now := time.Now().UTC()
				if err := f.server.DB.Model(&meta.ClientDevice{}).
					Where("id = ?", f.device.ID).Update("revoked_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			case "foreign-owner":
				c.Set("userID", f.device.OwnerID+1)
			case "wrong-root":
				c.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", strings.Repeat("f", 64))
			case "revised-source":
				if err := f.server.DB.Model(&meta.Source{}).
					Where("id = ?", f.source.ID).
					Update("revision", f.source.Revision+1).Error; err != nil {
					t.Fatal(err)
				}
			case "canceled-context":
				work, cancel := context.WithCancel(c.Request.Context())
				cancel()
				defer cancel()
				c.Request = c.Request.WithContext(work)
			}
			bound, err := f.server.bindBoundLocalPushOperationStage(
				c, f.source.ID, f.source.Revision, f.proof,
				stageID, key, operationID, generation)
			if err == nil || bound.StageID != "" {
				t.Fatalf("%s admitted unauthorized Stage correlation: %+v %v",
					scenario, bound, err)
			}
			if scenario != "missing-migration" {
				var rows int64
				if err := f.server.DB.Model(&meta.LocalPushOperationStageBinding{}).
					Count(&rows).Error; err != nil || rows != 0 {
					t.Fatalf("%s wrote private binding: count=%d err=%v", scenario, rows, err)
				}
			}
			var items, runs int64
			if err := f.server.DB.Model(&meta.SourceItem{}).Count(&items).Error; err != nil || items != 0 {
				t.Fatalf("%s wrote SourceItem: count=%d %v", scenario, items, err)
			}
			if err := f.server.DB.Model(&meta.SyncRun{}).Count(&runs).Error; err != nil || runs != 0 {
				t.Fatalf("%s started SourceRun: count=%d %v", scenario, runs, err)
			}
		})
	}
}

func TestLocalPushStageOperationBindingRejectsRebindingAfterAbort(t *testing.T) {
	f, key, operation := makeLocalPushFencedFirstLeafFixture(t)
	if err := f.server.DB.AutoMigrate(&meta.LocalPushOperationStageBinding{}); err != nil {
		t.Fatal(err)
	}
	original, err := f.server.bindBoundLocalPushOperationStage(
		f.ctx, f.source.ID, f.source.Revision, f.proof,
		f.stage.StageID, key, operation.ID, operation.Generation)
	if err != nil {
		t.Fatalf("original Stage binding denied: %v", err)
	}
	if err := f.server.abortBoundLocalPushOperationIntent(
		f.ctx, f.source.ID, f.source.Revision, operation.ID, operation.Generation); err != nil {
		t.Fatal(err)
	}
	freshKey := bytes.Repeat([]byte{0x89}, localPushOperationRequestKeySize)
	next, err := f.server.reserveBoundLocalPushOperationIntentWithKey(
		f.ctx, f.source.ID, f.source.Revision, freshKey)
	if err != nil || next.Generation != operation.Generation+1 {
		t.Fatalf("next private generation not reserved: %+v %v", next, err)
	}
	got, err := f.server.bindBoundLocalPushOperationStage(
		f.ctx, f.source.ID, f.source.Revision, f.proof,
		f.stage.StageID, freshKey, next.ID, next.Generation)
	if err == nil || got.StageID != "" {
		t.Fatalf("new generation rewrote historical Stage: %+v %v", got, err)
	}
	var persisted meta.LocalPushOperationStageBinding
	if err := f.server.DB.Where("stage_id = ?", original.StageID).
		Take(&persisted).Error; err != nil ||
		!sameLocalPushStageOperationIdentity(persisted, original) ||
		!persisted.BoundAt.Equal(original.BoundAt) {
		t.Fatalf("original immutable Stage binding lost: %+v %v", persisted, err)
	}
}
