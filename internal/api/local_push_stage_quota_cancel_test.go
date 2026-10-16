package api

import (
	"context"
	"net/http"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

func bindLocalStageCancelTestRoute(f localPushExistingCASTestFixture) {
	f.ctx.Params = gin.Params{
		{Key: "id", Value: strconv.FormatUint(f.source.ID, 10)},
		{Key: "stageID", Value: f.stage.StageID},
	}
	f.ctx.Request.Header.Set("If-Match", "\"7\"")
}

func TestLocalPushStageCancelReleasesBookedOwnerQuota(t *testing.T) {
	f := makeLocalPushQuotaHoldFixture(t)
	size := int64(len(f.body))
	setLocalPushQuotaFixture(t, f, size)
	if created, err := f.reserveLocalQuota(); !created || err != nil {
		t.Fatalf("quota booking: created=%t err=%v", created, err)
	}
	bindLocalStageCancelTestRoute(f)
	f.server.cancelLocalPushStage(f.ctx)
	if f.ctx.Writer.Status() != http.StatusNoContent {
		t.Fatalf("cancel status=%d", f.ctx.Writer.Status())
	}
	var stage meta.LocalPushStaging
	if err := f.server.DB.Where("source_id = ?", f.source.ID).Take(&stage).Error; err != nil || stage.Status != localPushStageCanceled {
		t.Fatalf("Stage not canceled: %+v err=%v", stage, err)
	}
	var first meta.LocalPushQuotaHold
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&first).Error; err != nil || first.ReleasedAt == nil {
		t.Fatalf("quota hold was not released: %+v err=%v", first, err)
	}
	usage, err := f.server.loadQuotaUsage(f.server.DB, f.device.OwnerID, false)
	if err != nil || usage.ReservedBytes != 0 {
		t.Fatalf("quota still reserved after cancel: %+v err=%v", usage, err)
	}
	if _, err := f.server.ensureQuota(f.server.DB, f.device.OwnerID, 1, true); err != nil {
		t.Fatalf("ordinary upload still blocked after cancel: %v", err)
	}
	file, err := f.local.Open(context.Background(), f.casKey)
	if err != nil {
		t.Fatalf("cancel deleted canonical CAS: %v", err)
	}
	_ = file.Close()

	// Exact cancellation replay is idempotent.
	f.server.cancelLocalPushStage(f.ctx)
	var after meta.LocalPushQuotaHold
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&after).Error; err != nil || after.ReleasedAt == nil ||
		!after.ReleasedAt.Equal(*first.ReleasedAt) {
		t.Fatalf("cancellation replay modified the hold: %+v err=%v", after, err)
	}
}

func TestLocalPushStageCancelDeniesForgedAndChangedStatesWithoutQuotaRelease(t *testing.T) {
	for _, variant := range []string{"forged-token", "writing-stage", "mismatched-hold"} {
		t.Run(variant, func(t *testing.T) {
			f := makeLocalPushQuotaHoldFixture(t)
			size := int64(len(f.body))
			setLocalPushQuotaFixture(t, f, size)
			if created, err := f.reserveLocalQuota(); !created || err != nil {
				t.Fatalf("quota booking: created=%t err=%v", created, err)
			}
			bindLocalStageCancelTestRoute(f)
			switch variant {
			case "forged-token":
				f.ctx.Request.Header.Set("X-XDrive-Device-Token", "invalid-secret")
			case "writing-stage":
				if err := f.server.DB.Model(&meta.LocalPushStaging{}).
					Where("source_id = ?", f.source.ID).Update("status", localPushStageWriting).Error; err != nil {
					t.Fatal(err)
				}
			case "mismatched-hold":
				if err := f.server.DB.Model(&meta.LocalPushQuotaHold{}).
					Where("stage_id = ?", f.stage.StageID).
					Update("content_sha256", "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee").Error; err != nil {
					t.Fatal(err)
				}
			}
			f.server.cancelLocalPushStage(f.ctx)
			if f.ctx.Writer.Status() == http.StatusNoContent {
				t.Fatalf("%s was improperly canceled", variant)
			}
			var stage meta.LocalPushStaging
			if err := f.server.DB.Where("source_id = ?", f.source.ID).Take(&stage).Error; err != nil ||
				stage.Status == localPushStageCanceled {
				t.Fatalf("%s changed Stage status: %+v err=%v", variant, stage, err)
			}
			var hold meta.LocalPushQuotaHold
			if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&hold).Error; err != nil ||
				hold.ReleasedAt != nil {
				t.Fatalf("%s released a hold without authority: %+v err=%v", variant, hold, err)
			}
			usage, err := f.server.loadQuotaUsage(f.server.DB, f.device.OwnerID, false)
			if err != nil || usage.ReservedBytes != size {
				t.Fatalf("%s lost booked quota: %+v err=%v", variant, usage, err)
			}
		})
	}
}

func TestLocalPushStageCancelWithoutHoldRemainsSupported(t *testing.T) {
	f := makeLocalPushQuotaHoldFixture(t)
	bindLocalStageCancelTestRoute(f)
	f.server.cancelLocalPushStage(f.ctx)
	if f.ctx.Writer.Status() != http.StatusNoContent {
		t.Fatalf("cancel without hold status=%d", f.ctx.Writer.Status())
	}
	var count int64
	if err := f.server.DB.Model(&meta.LocalPushQuotaHold{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("cancel without reservation unexpectedly booked quota: count=%d err=%v", count, err)
	}
}
