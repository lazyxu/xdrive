package api

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

func makeLocalPushQuotaHoldFixture(t *testing.T) localPushExistingCASTestFixture {
	t.Helper()
	f := makeLocalPushQuotaPinnedFixture(t)
	if err := f.server.DB.AutoMigrate(&meta.LocalPushQuotaHold{}); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f localPushExistingCASTestFixture) reserveLocalQuota() (bool, error) {
	return f.server.reserveBoundLocalPushQuota(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
	)
}

func TestLocalPushQuotaHoldBooksExactlyOnceAndCountsForNormalUploads(t *testing.T) {
	f := makeLocalPushQuotaHoldFixture(t)
	size := int64(len(f.body))
	setLocalPushQuotaFixture(t, f, size)
	sqlDB, err := f.server.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if created, err := f.reserveLocalQuota(); err != nil || !created {
		t.Fatalf("owning Stage quota booking failed: created=%t err=%v", created, err)
	}
	var first meta.LocalPushQuotaHold
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&first).Error; err != nil {
		t.Fatal(err)
	}
	// PostgreSQL stores timestamps at microsecond precision; use the
	// Stage fetched from the database, not the original nanosecond value.
	var persistedStage meta.LocalPushStaging
	if err := f.server.DB.Where("source_id = ?", f.source.ID).Take(&persistedStage).Error; err != nil {
		t.Fatal(err)
	}
	if first.Bytes != size || !sameLocalPushQuotaHold(first, persistedStage) || first.ReleasedAt != nil {
		t.Fatalf("unsafe persistent owner quota hold: %+v", first)
	}
	if created, err := f.reserveLocalQuota(); created || err != nil {
		t.Fatalf("exact replay double-booked owner quota: created=%t err=%v", created, err)
	}
	var second meta.LocalPushQuotaHold
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&second).Error; err != nil ||
		!first.CreatedAt.Equal(second.CreatedAt) || !first.UpdatedAt.Equal(second.UpdatedAt) {
		t.Fatalf("replay rewrote durable quota hold: %+v err=%v", second, err)
	}
	usage, err := f.server.loadQuotaUsage(f.server.DB, f.device.OwnerID, false)
	if err != nil || usage.ReservedBytes != size || usage.PhysicalUsedBytes != 0 {
		t.Fatalf("quota accounting did not include single hold: %+v err=%v", usage, err)
	}
	if _, err := f.server.ensureQuota(f.server.DB, f.device.OwnerID, 1, true); err == nil {
		t.Fatal("ordinary upload quota check ignored active local Push hold")
	}
	var blobs, items, runs int64
	if err := f.server.DB.Model(&meta.ContentBlob{}).Count(&blobs).Error; err != nil || blobs != 0 {
		t.Fatalf("quota booked authoritative CAS metadata: %d err=%v", blobs, err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).Where("source_id = ?", f.source.ID).
		Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("quota booked SourceItem: %d err=%v", items, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).Where("source_id = ?", f.source.ID).
		Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("quota booked SourceRun: %d err=%v", runs, err)
	}
	var source meta.Source
	if err := f.server.DB.Where("id = ?", f.source.ID).Take(&source).Error; err != nil ||
		source.Status != meta.SourceStatusPaused {
		t.Fatalf("quota booking activated Push: %+v err=%v", source, err)
	}
}

func TestLocalPushQuotaHoldDeniesShortageAndNeverTouchesPhysicalStorage(t *testing.T) {
	f := makeLocalPushQuotaHoldFixture(t)
	setLocalPushQuotaFixture(t, f, int64(len(f.body))-1)
	called := false
	created, err := f.server.reserveBoundLocalPushQuotaWithInspector(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
		func(context.Context, string, string, int64, func(context.Context) error) (bool, error) {
			called = true
			return true, nil
		},
	)
	var quotaErr *quotaExceededError
	if created || !errors.As(err, &quotaErr) || called {
		t.Fatalf("over-quota hold admitted: created=%t err=%v called=%t", created, err, called)
	}
	var count int64
	if err := f.server.DB.Model(&meta.LocalPushQuotaHold{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("quota shortage persisted reservation: %d err=%v", count, err)
	}
}

func TestLocalPushQuotaHoldExpiresAutomaticallyFromOwnerUsage(t *testing.T) {
	f := makeLocalPushQuotaHoldFixture(t)
	setLocalPushQuotaFixture(t, f, int64(len(f.body)))
	if created, err := f.reserveLocalQuota(); !created || err != nil {
		t.Fatalf("initial quota booking failed: created=%t err=%v", created, err)
	}
	now := time.Now().UTC()
	if err := f.server.DB.Model(&meta.LocalPushQuotaHold{}).
		Where("stage_id = ?", f.stage.StageID).Update("expires_at", now.Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	usage, err := f.server.loadQuotaUsage(f.server.DB, f.device.OwnerID, false)
	if err != nil || usage.ReservedBytes != 0 {
		t.Fatalf("expired quota hold was still charged: usage=%+v err=%v", usage, err)
	}
	if created, err := f.reserveLocalQuota(); created || err == nil {
		t.Fatalf("expired existing hold was reactivated: created=%t err=%v", created, err)
	}

	// A released hold is also excluded and can never be reactivated by an
	// exact Stage replay. There is no remote owner-only release endpoint.
	if err := f.server.DB.Model(&meta.LocalPushQuotaHold{}).
		Where("stage_id = ?", f.stage.StageID).Updates(map[string]any{
		"expires_at": f.stage.ExpiresAt, "released_at": &now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	usage, err = f.server.loadQuotaUsage(f.server.DB, f.device.OwnerID, false)
	if err != nil || usage.ReservedBytes != 0 {
		t.Fatalf("released quota hold was still charged: usage=%+v err=%v", usage, err)
	}
	if created, err := f.reserveLocalQuota(); created || err == nil {
		t.Fatalf("released hold was reactivated: created=%t err=%v", created, err)
	}
}

func TestLocalPushQuotaHoldSerializesTwoSourcesAgainstOneOwnerQuota(t *testing.T) {
	f := makeLocalPushQuotaHoldFixture(t)
	size := int64(len(f.body))
	setLocalPushQuotaFixture(t, f, size)
	if created, err := f.reserveLocalQuota(); !created || err != nil {
		t.Fatalf("initial Source quota booking failed: created=%t err=%v", created, err)
	}
	secondSource := f.source
	secondSource.ID = 0
	secondSource.Name = "second local Push source"
	secondSource.CreatedAt = time.Time{}
	secondSource.UpdatedAt = time.Time{}
	if err := f.server.DB.Create(&secondSource).Error; err != nil {
		t.Fatal(err)
	}
	binding := meta.LocalSourceBinding{
		SourceID: secondSource.ID, OwnerID: f.device.OwnerID,
		DeviceID: f.device.ID, RootID: f.proof.RootID,
		RootFingerprint: f.stage.RootFingerprint,
	}
	if err := f.server.DB.Create(&binding).Error; err != nil {
		t.Fatal(err)
	}
	secondStage := f.stage
	secondStage.SourceID = secondSource.ID
	secondStage.StageID = uuid.NewString()
	secondStage.CreatedAt = time.Time{}
	secondStage.UpdatedAt = time.Time{}
	if err := f.server.DB.Create(&secondStage).Error; err != nil {
		t.Fatal(err)
	}
	stageKey, err := localPushStageStoreKey(secondStage.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.local.Put(context.Background(), stageKey, bytes.NewReader(f.body)); err != nil {
		t.Fatal(err)
	}
	if created, err := f.server.quarantineBoundLocalPushCASPrepareIntent(
		f.ctx, secondSource.ID, secondSource.Revision, f.proof, secondStage.StageID,
	); !created || err != nil {
		t.Fatalf("second Source quarantine failed: created=%t err=%v", created, err)
	}
	if created, err := f.server.reserveBoundLocalPushQuota(
		f.ctx, secondSource.ID, secondSource.Revision, f.proof, secondStage.StageID,
	); created || err == nil {
		t.Fatalf("second Source exceeded serialized owner quota: created=%t err=%v", created, err)
	}
	var count int64
	if err := f.server.DB.Model(&meta.LocalPushQuotaHold{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("two Stages booked more than one quota slot: %d err=%v", count, err)
	}
}

func TestLocalPushQuotaHoldBlocksStaleCredentialQuarantineAndCAS(t *testing.T) {
	for _, variant := range []string{"forged", "revoked", "stage", "intent", "blob"} {
		t.Run(variant, func(t *testing.T) {
			f := makeLocalPushQuotaHoldFixture(t)
			setLocalPushQuotaFixture(t, f, int64(len(f.body)))
			switch variant {
			case "forged":
				f.ctx.Request.Header.Set("X-XDrive-Device-Token", "second-device-secret")
			case "revoked":
				now := time.Now().UTC()
				if err := f.server.DB.Model(&meta.ClientDevice{}).
					Where("id = ?", f.device.ID).Update("revoked_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			case "stage":
				if err := f.server.DB.Model(&meta.LocalPushStaging{}).
					Where("source_id = ?", f.source.ID).Update("status", localPushStageCanceled).Error; err != nil {
					t.Fatal(err)
				}
			case "intent":
				if err := f.server.DB.Model(&meta.LocalPushCASPrepareIntent{}).
					Where("stage_id = ?", f.stage.StageID).Update("state", "invalid").Error; err != nil {
					t.Fatal(err)
				}
			case "blob":
				if err := f.server.DB.Create(&meta.ContentBlob{
					SHA256: f.stage.ContentSHA256, StorageKey: f.casKey,
					Size: int64(len(f.body)), State: meta.ContentBlobStateDeleting,
				}).Error; err != nil {
					t.Fatal(err)
				}
			}
			if created, err := f.reserveLocalQuota(); created || err == nil {
				t.Fatalf("%s scope booked owner quota: created=%t err=%v", variant, created, err)
			}
			var count int64
			if err := f.server.DB.Model(&meta.LocalPushQuotaHold{}).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("%s denial created hold: %d err=%v", variant, count, err)
			}
		})
	}
}

func TestLocalPushQuotaHoldBusyCancelAndLatePhysicalFailure(t *testing.T) {
	for _, variant := range []string{"busy", "cancel", "late-corruption"} {
		t.Run(variant, func(t *testing.T) {
			f := makeLocalPushQuotaHoldFixture(t)
			setLocalPushQuotaFixture(t, f, int64(len(f.body)))
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if variant == "cancel" {
				f.ctx.Request = f.ctx.Request.WithContext(ctx)
			}
			sentinel := errors.New("synthetic post-commit physical mismatch")
			created, err := f.server.reserveBoundLocalPushQuotaWithInspector(
				f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
				func(held context.Context, stageKey, casKey string, size int64,
					inside func(context.Context) error) (bool, error) {
					switch variant {
					case "busy":
						return false, nil
					case "cancel":
						cancel()
						return false, held.Err()
					case "late-corruption":
						if err := inside(held); err != nil {
							return false, err
						}
						return false, sentinel
					}
					return false, sentinel
				},
			)
			if created {
				t.Fatalf("%s produced an upload success ticket", variant)
			}
			if variant == "busy" && err != nil {
				t.Fatalf("busy OS shard returned error: %v", err)
			}
			if variant == "cancel" && !errors.Is(err, context.Canceled) {
				t.Fatalf("canceled reservation was admitted: %v", err)
			}
			if variant == "late-corruption" && !errors.Is(err, sentinel) {
				t.Fatalf("post-commit physical error hidden: %v", err)
			}
			var count int64
			if err := f.server.DB.Model(&meta.LocalPushQuotaHold{}).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if variant == "late-corruption" && count != 1 {
				t.Fatalf("late physical drift did not retain conservative expiring slot: %d", count)
			}
			if variant != "late-corruption" && count != 0 {
				t.Fatalf("%s unexpectedly reserved quota: %d", variant, count)
			}
		})
	}
}
