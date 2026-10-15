package api

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

func makeLocalPushCASPrepareIntentFixture(t *testing.T) localPushExistingCASTestFixture {
	t.Helper()
	f := makeLocalPushNewCASPrecommitFixture(t)
	if err := f.server.DB.AutoMigrate(&meta.LocalPushCASPrepareIntent{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f localPushExistingCASTestFixture) quarantineNewCAS() (bool, error) {
	return f.server.quarantineBoundLocalPushCASPrepareIntent(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
	)
}

func TestLocalPushCASPrepareIntentDurableQuarantineExactReplayNoCanonicalMutation(t *testing.T) {
	f := makeLocalPushCASPrepareIntentFixture(t)
	created, err := f.quarantineNewCAS()
	if err != nil || !created {
		t.Fatalf("owning-device quarantine failed: created=%t err=%v", created, err)
	}
	var first meta.LocalPushCASPrepareIntent
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&first).Error; err != nil {
		t.Fatal(err)
	}
	var originalStage meta.LocalPushStaging
	if err := f.server.DB.Where("source_id = ?", f.source.ID).Take(&originalStage).Error; err != nil {
		t.Fatal(err)
	}
	if first.State != meta.LocalPushCASPrepareIntentQuarantined ||
		!sameLocalPushCASPrepareIntent(first, originalStage) {
		t.Fatalf("unsafe or unmatched persistent intent: %+v", first)
	}
	created, err = f.quarantineNewCAS()
	if err != nil || created {
		t.Fatalf("exact replay was not idempotent: created=%t err=%v", created, err)
	}
	var count int64
	if err := f.server.DB.Model(&meta.LocalPushCASPrepareIntent{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("replay duplicated quarantine: %d err=%v", count, err)
	}
	var after meta.LocalPushCASPrepareIntent
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&after).Error; err != nil ||
		!after.CreatedAt.Equal(first.CreatedAt) || !after.UpdatedAt.Equal(first.UpdatedAt) {
		t.Fatalf("replay rewrote durable quarantine: %+v err=%v", after, err)
	}
	var blobs, items, runs int64
	if err := f.server.DB.Model(&meta.ContentBlob{}).Where("sha256 = ?", f.stage.ContentSHA256).
		Count(&blobs).Error; err != nil || blobs != 0 {
		t.Fatalf("quarantine created ContentBlob: %d err=%v", blobs, err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).Where("source_id = ?", f.source.ID).
		Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("quarantine created SourceItem: %d err=%v", items, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).Where("source_id = ?", f.source.ID).
		Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("quarantine created SourceRun: %d err=%v", runs, err)
	}
	var source meta.Source
	if err := f.server.DB.Where("id = ?", f.source.ID).Take(&source).Error; err != nil ||
		source.Status != meta.SourceStatusPaused || source.Revision != f.source.Revision {
		t.Fatalf("quarantine activated Source: %+v err=%v", source, err)
	}
	if file, err := f.local.Open(context.Background(), f.casKey); err == nil {
		_ = file.Close()
		t.Fatal("quarantine unexpectedly published physical canonical CAS")
	}
}

func TestLocalPushCASPrepareIntentNoForeignOrRevokedDeviceAuthority(t *testing.T) {
	f := makeLocalPushCASPrepareIntentFixture(t)
	f.ctx.Set(localSourceExecutorContextKey, localSourceExecutorProof{
		DeviceID: uuid.NewString(), RootID: f.proof.RootID, SourceRevision: f.proof.SourceRevision,
	})
	if created, err := f.quarantineNewCAS(); created ||
		!errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
		t.Fatalf("foreign proof admitted: created=%t err=%v", created, err)
	}
	f.ctx.Set(localSourceExecutorContextKey, f.proof)
	f.ctx.Request.Header.Set("X-XDrive-Device-Token", "forged-other-device-token")
	if created, err := f.quarantineNewCAS(); created || err == nil {
		t.Fatalf("forged credential admitted: created=%t err=%v", created, err)
	}
	f.ctx.Request.Header.Set("X-XDrive-Device-Token", "local-precommit-owning-device-test-secret")
	otherDevice := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: f.device.OwnerID, Name: "second native device", Platform: "windows",
		CredentialHash: deviceCredentialDigest("actual-enrolled-other-device-credential"),
	}
	if err := f.server.DB.Create(&otherDevice).Error; err != nil {
		t.Fatal(err)
	}
	f.ctx.Set(localSourceExecutorContextKey, localSourceExecutorProof{
		DeviceID: otherDevice.ID, RootID: f.proof.RootID, SourceRevision: f.proof.SourceRevision,
	})
	f.ctx.Request.Header.Set("X-XDrive-Device-Token", "actual-enrolled-other-device-credential")
	if created, err := f.server.quarantineBoundLocalPushCASPrepareIntent(
		f.ctx, f.source.ID, 7, localSourceExecutorProof{
			DeviceID: otherDevice.ID, RootID: f.proof.RootID, SourceRevision: 7,
		}, f.stage.StageID,
	); created || err == nil {
		t.Fatalf("same-account other native device admitted: created=%t err=%v", created, err)
	}
	f.ctx.Set(localSourceExecutorContextKey, f.proof)
	f.ctx.Request.Header.Set("X-XDrive-Device-Token", "local-precommit-owning-device-test-secret")
	now := time.Now().UTC()
	if err := f.server.DB.Model(&meta.ClientDevice{}).
		Where("id = ?", f.device.ID).Update("revoked_at", &now).Error; err != nil {
		t.Fatal(err)
	}
	if created, err := f.quarantineNewCAS(); created || err == nil {
		t.Fatalf("revoked owning device admitted: created=%t err=%v", created, err)
	}
	var count int64
	if err := f.server.DB.Model(&meta.LocalPushCASPrepareIntent{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("unauthorized writes persisted: count=%d err=%v", count, err)
	}
}

func TestLocalPushCASPrepareIntentDeniesExistingBlobStaleOrReplacedStage(t *testing.T) {
	f := makeLocalPushCASPrepareIntentFixture(t)
	if err := f.server.DB.Create(&meta.ContentBlob{
		SHA256: f.stage.ContentSHA256, Size: int64(len(f.body)),
		StorageKey: f.casKey, State: meta.ContentBlobStateReady, RefCount: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if created, err := f.quarantineNewCAS(); created || err == nil {
		t.Fatalf("existing ContentBlob hijacked: created=%t err=%v", created, err)
	}
	if err := f.server.DB.Where("sha256 = ?", f.stage.ContentSHA256).
		Delete(&meta.ContentBlob{}).Error; err != nil {
		t.Fatal(err)
	}
	if created, err := f.quarantineNewCAS(); !created || err != nil {
		t.Fatalf("clean Stage not admitted: created=%t err=%v", created, err)
	}
	if err := f.server.DB.Model(&meta.LocalPushStaging{}).
		Where("source_id = ?", f.source.ID).Update("current_path_key", "replacement-path-key").Error; err != nil {
		t.Fatal(err)
	}
	if created, err := f.quarantineNewCAS(); created || err == nil {
		t.Fatalf("tampered Stage overwrote quarantine: created=%t err=%v", created, err)
	}
	if err := f.server.DB.Model(&meta.LocalPushStaging{}).
		Where("source_id = ?", f.source.ID).Updates(map[string]any{
		"current_path_key": f.stage.CurrentPathKey, "status": localPushStageCanceled,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if created, err := f.quarantineNewCAS(); created || err == nil {
		t.Fatalf("canceled Stage replayed quarantine: created=%t err=%v", created, err)
	}
	var saved meta.LocalPushCASPrepareIntent
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&saved).Error; err != nil ||
		saved.StageID != f.stage.StageID || saved.State != meta.LocalPushCASPrepareIntentQuarantined ||
		saved.CurrentPathKey != f.stage.CurrentPathKey {
		t.Fatalf("stale replay changed persisted intent: %+v err=%v", saved, err)
	}
}

func TestLocalPushCASPrepareIntentRejectsRevisionExpiryAndCancelledTransaction(t *testing.T) {
	for _, variant := range []string{"revision", "expiry", "canceled"} {
		t.Run(variant, func(t *testing.T) {
			f := makeLocalPushCASPrepareIntentFixture(t)
			switch variant {
			case "revision":
				if err := f.server.DB.Model(&meta.Source{}).Where("id = ?", f.source.ID).
					Update("revision", f.source.Revision+1).Error; err != nil {
					t.Fatal(err)
				}
			case "expiry":
				if err := f.server.DB.Model(&meta.LocalPushStaging{}).
					Where("source_id = ?", f.source.ID).
					Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
					t.Fatal(err)
				}
			case "canceled":
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				f.ctx.Request = f.ctx.Request.WithContext(ctx)
			}
			if created, err := f.quarantineNewCAS(); created || err == nil {
				t.Fatalf("invalid %s scope admitted: created=%t err=%v", variant, created, err)
			}
			var count int64
			if err := f.server.DB.Model(&meta.LocalPushCASPrepareIntent{}).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("failed operation persisted quarantine: count=%d err=%v", count, err)
			}
		})
	}
}
