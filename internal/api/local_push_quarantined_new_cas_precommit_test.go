package api

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestLocalPushQuarantinePhysicalRequiresLiveIntentAndKeepsCASUnreferenced(t *testing.T) {
	f := makeLocalPushCASPrepareIntentFixture(t)
	called := false
	mock := func(context.Context, string, string, int64) (bool, bool, error) {
		called = true
		return true, true, nil
	}
	if ok, err := f.server.prepareBoundLocalPushNewCASWithMaterializerScoped(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID, mock, true,
	); ok || err == nil || called {
		t.Fatalf("missing durable quarantine reached physical phase: ok=%t err=%v called=%t", ok, err, called)
	}
	if created, err := f.quarantineNewCAS(); err != nil || !created {
		t.Fatalf("could not persist one exact quarantine: created=%t err=%v", created, err)
	}
	var first meta.LocalPushCASPrepareIntent
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&first).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if ok, err := f.server.prepareQuarantinedBoundLocalPushNewCAS(
			f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		); err != nil || !ok {
			t.Fatalf("authorized physical prepare or exact replay %d failed: ok=%t err=%v", i, ok, err)
		}
	}
	file, err := f.local.Open(context.Background(), f.casKey)
	if err != nil {
		t.Fatal(err)
	}
	body, readErr := io.ReadAll(file)
	closeErr := file.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(body, f.body) {
		t.Fatalf("unreferenced physical CAS differs: read=%v close=%v", readErr, closeErr)
	}
	var after meta.LocalPushCASPrepareIntent
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&after).Error; err != nil ||
		after.State != meta.LocalPushCASPrepareIntentQuarantined ||
		!after.CreatedAt.Equal(first.CreatedAt) || !after.UpdatedAt.Equal(first.UpdatedAt) {
		t.Fatalf("physical precommit mutated persistent intent: %+v err=%v", after, err)
	}
	var blobs, items, runs int64
	if err := f.server.DB.Model(&meta.ContentBlob{}).Where("sha256 = ?", f.stage.ContentSHA256).
		Count(&blobs).Error; err != nil || blobs != 0 {
		t.Fatalf("physical CAS gained SQL reference: %d err=%v", blobs, err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).Where("source_id = ?", f.source.ID).
		Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("unexpected SourceItem: %d err=%v", items, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).Where("source_id = ?", f.source.ID).
		Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("unexpected SyncRun: %d err=%v", runs, err)
	}
	var source meta.Source
	if err := f.server.DB.Where("id = ?", f.source.ID).Take(&source).Error; err != nil ||
		source.Status != meta.SourceStatusPaused {
		t.Fatalf("physical prepare activated local Push: %+v err=%v", source, err)
	}
}

func TestLocalPushQuarantinePhysicalRejectsAlteredIntentBeforeBytes(t *testing.T) {
	for _, variant := range []string{"state", "target", "deleted", "expired", "existing-blob"} {
		t.Run(variant, func(t *testing.T) {
			f := makeLocalPushCASPrepareIntentFixture(t)
			if created, err := f.quarantineNewCAS(); err != nil || !created {
				t.Fatal("quarantine fixture failed", err)
			}
			switch variant {
			case "state":
				if err := f.server.DB.Model(&meta.LocalPushCASPrepareIntent{}).
					Where("stage_id = ?", f.stage.StageID).Update("state", "changed").Error; err != nil {
					t.Fatal(err)
				}
			case "target":
				if err := f.server.DB.Model(&meta.LocalPushCASPrepareIntent{}).
					Where("stage_id = ?", f.stage.StageID).Update("target_node_id", f.stage.TargetNodeID+1).Error; err != nil {
					t.Fatal(err)
				}
			case "deleted":
				if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).
					Delete(&meta.LocalPushCASPrepareIntent{}).Error; err != nil {
					t.Fatal(err)
				}
			case "expired":
				if err := f.server.DB.Model(&meta.LocalPushStaging{}).
					Where("source_id = ?", f.source.ID).Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
					t.Fatal(err)
				}
			case "existing-blob":
				if err := f.server.DB.Create(&meta.ContentBlob{
					SHA256: f.stage.ContentSHA256, Size: int64(len(f.body)),
					StorageKey: f.casKey, State: meta.ContentBlobStateDeleting, RefCount: 0,
				}).Error; err != nil {
					t.Fatal(err)
				}
			}
			called := false
			ok, err := f.server.prepareBoundLocalPushNewCASWithMaterializerScoped(
				f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
				func(context.Context, string, string, int64) (bool, bool, error) {
					called = true
					return true, true, nil
				}, true,
			)
			if ok || err == nil || called {
				t.Fatalf("%s reached physical phase: ok=%t err=%v called=%t", variant, ok, err, called)
			}
		})
	}
}

func TestLocalPushQuarantinePhysicalRejectsMidflightDrift(t *testing.T) {
	for _, variant := range []string{"intent", "intent-touched", "revoked", "source", "stage", "blob"} {
		t.Run(variant, func(t *testing.T) {
			f := makeLocalPushCASPrepareIntentFixture(t)
			if created, err := f.quarantineNewCAS(); err != nil || !created {
				t.Fatal("quarantine fixture failed", err)
			}
			calls := 0
			ok, err := f.server.prepareBoundLocalPushNewCASWithMaterializerScoped(
				f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
				func(context.Context, string, string, int64) (bool, bool, error) {
					calls++
					var changeErr error
					switch variant {
					case "intent":
						changeErr = f.server.DB.Model(&meta.LocalPushCASPrepareIntent{}).
							Where("stage_id = ?", f.stage.StageID).Update("state", "superseded").Error
					case "intent-touched":
						changeErr = f.server.DB.Model(&meta.LocalPushCASPrepareIntent{}).
							Where("stage_id = ?", f.stage.StageID).
							Update("updated_at", time.Now().Add(time.Hour)).Error
					case "revoked":
						now := time.Now().UTC()
						changeErr = f.server.DB.Model(&meta.ClientDevice{}).
							Where("id = ?", f.device.ID).Update("revoked_at", &now).Error
					case "source":
						changeErr = f.server.DB.Model(&meta.Source{}).
							Where("id = ?", f.source.ID).Update("revision", 8).Error
					case "stage":
						changeErr = f.server.DB.Model(&meta.LocalPushStaging{}).
							Where("source_id = ?", f.source.ID).Update("status", localPushStageCanceled).Error
					case "blob":
						changeErr = f.server.DB.Create(&meta.ContentBlob{
							SHA256: f.stage.ContentSHA256, Size: int64(len(f.body)),
							StorageKey: f.casKey, State: meta.ContentBlobStateReady, RefCount: 1,
						}).Error
					}
					return true, true, changeErr
				}, true,
			)
			if ok || err == nil || calls != 1 {
				t.Fatalf("midflight %s admitted: ok=%t err=%v calls=%d", variant, ok, err, calls)
			}
		})
	}
}

func TestLocalPushQuarantinePhysicalPreservesOwnershipCancellationAndBusyDenial(t *testing.T) {
	f := makeLocalPushCASPrepareIntentFixture(t)
	if created, err := f.quarantineNewCAS(); err != nil || !created {
		t.Fatal("quarantine fixture failed", err)
	}
	f.ctx.Set(localSourceExecutorContextKey, localSourceExecutorProof{
		DeviceID: uuid.NewString(), RootID: f.proof.RootID, SourceRevision: 7,
	})
	if ok, err := f.server.prepareQuarantinedBoundLocalPushNewCAS(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
	); ok || !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
		t.Fatalf("foreign device reached physical storage: ok=%t err=%v", ok, err)
	}
	f.ctx.Set(localSourceExecutorContextKey, f.proof)
	f.ctx.Request.Header.Set("X-XDrive-Device-Token", "forged-token")
	if ok, err := f.server.prepareQuarantinedBoundLocalPushNewCAS(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
	); ok || err == nil {
		t.Fatalf("forged token reached physical storage: ok=%t err=%v", ok, err)
	}
	f.ctx.Request.Header.Set("X-XDrive-Device-Token", "local-precommit-owning-device-test-secret")
	if ok, err := f.server.prepareBoundLocalPushNewCASWithMaterializerScoped(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
		func(context.Context, string, string, int64) (bool, bool, error) {
			return false, false, nil
		}, true,
	); ok || err != nil {
		t.Fatalf("busy storage must not admit: ok=%t err=%v", ok, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	f.ctx.Request = f.ctx.Request.WithContext(ctx)
	if ok, err := f.server.prepareBoundLocalPushNewCASWithMaterializerScoped(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
		func(context.Context, string, string, int64) (bool, bool, error) {
			cancel()
			return true, true, nil
		}, true,
	); ok || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel granted physical success: ok=%t err=%v", ok, err)
	}
}
