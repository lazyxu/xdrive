package api

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestLocalPushExistingCASPrecommitRejectsMidflightRevocationAndRevision(t *testing.T) {
	f := makeLocalPushExistingCASTestFixture(t)
	for _, tc := range []struct {
		name    string
		change  func() error
		restore func() error
	}{
		{
			name: "device revoked",
			change: func() error {
				now := time.Now().UTC()
				return f.server.DB.Model(&meta.ClientDevice{}).
					Where("id = ?", f.device.ID).Update("revoked_at", &now).Error
			},
			restore: func() error {
				return f.server.DB.Model(&meta.ClientDevice{}).
					Where("id = ?", f.device.ID).Update("revoked_at", nil).Error
			},
		},
		{
			name: "source revision changed",
			change: func() error {
				return f.server.DB.Model(&meta.Source{}).
					Where("id = ?", f.source.ID).Update("revision", 8).Error
			},
			restore: func() error {
				return f.server.DB.Model(&meta.Source{}).
					Where("id = ?", f.source.ID).Update("revision", 7).Error
			},
		},
		{
			name: "staging canceled",
			change: func() error {
				return f.server.DB.Model(&meta.LocalPushStaging{}).
					Where("source_id = ?", f.source.ID).
					Update("status", localPushStageCanceled).Error
			},
			restore: func() error {
				return f.server.DB.Model(&meta.LocalPushStaging{}).
					Where("source_id = ?", f.source.ID).
					Update("status", localPushStageReady).Error
			},
		},
		{
			name: "CAS refcount changed",
			change: func() error {
				return f.server.DB.Model(&meta.ContentBlob{}).
					Where("sha256 = ?", f.stage.ContentSHA256).
					Update("ref_count", 2).Error
			},
			restore: func() error {
				return f.server.DB.Model(&meta.ContentBlob{}).
					Where("sha256 = ?", f.stage.ContentSHA256).
					Update("ref_count", 1).Error
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			readerCalled := 0
			matched, err := f.server.observeBoundLocalPushExistingCASWithReader(
				f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
				func(context.Context, string, string, int64) (bool, error) {
					readerCalled++
					return true, tc.change()
				},
			)
			if matched || err == nil || readerCalled != 1 {
				t.Fatalf("midflight %s was accepted: matched=%t err=%v reads=%d", tc.name, matched, err, readerCalled)
			}
			if err := tc.restore(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestLocalPushExistingCASPrecommitBusyOrCanceledNeverBecomesCommit(t *testing.T) {
	f := makeLocalPushExistingCASTestFixture(t)
	if ok, err := f.server.observeBoundLocalPushExistingCASWithReader(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
		func(context.Context, string, string, int64) (bool, error) { return false, nil },
	); ok || err != nil {
		t.Fatalf("busy OS lock incorrectly granted authority: ok=%t err=%v", ok, err)
	}
	cancelCtx, cancel := context.WithCancel(context.Background())
	f.ctx.Request = f.ctx.Request.WithContext(cancelCtx)
	if ok, err := f.server.observeBoundLocalPushExistingCASWithReader(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
		func(context.Context, string, string, int64) (bool, error) {
			cancel()
			return true, nil
		},
	); ok || !errors.Is(err, context.Canceled) {
		t.Fatalf("midflight cancellation granted authority: ok=%t err=%v", ok, err)
	}
}
