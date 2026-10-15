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

// Reuse the real registered owning-device/Root/staged-original PostgreSQL
// fixture, but remove the previously referenced CAS object and SQL row.
func makeLocalPushNewCASPrecommitFixture(t *testing.T) localPushExistingCASTestFixture {
	t.Helper()
	f := makeLocalPushExistingCASTestFixture(t)
	if err := f.server.DB.Where("sha256 = ?", f.stage.ContentSHA256).
		Delete(&meta.ContentBlob{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.local.Delete(context.Background(), f.casKey); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f localPushExistingCASTestFixture) prepareNewCAS() (bool, error) {
	return f.server.prepareBoundLocalPushNewCAS(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
	)
}

func TestLocalPushNewCASPrecommitOwnAgentPhysicalOnlyAndExactReplay(t *testing.T) {
	f := makeLocalPushNewCASPrecommitFixture(t)
	for attempt := 0; attempt < 2; attempt++ {
		ok, err := f.prepareNewCAS()
		if err != nil || !ok {
			t.Fatalf("physical-only preparation attempt %d failed: ok=%t err=%v", attempt, ok, err)
		}
	}
	reader, err := f.local.Open(context.Background(), f.casKey)
	if err != nil {
		t.Fatal(err)
	}
	got, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(got, f.body) {
		t.Fatalf("canonical CAS physical bytes differ: read=%v close=%v", readErr, closeErr)
	}
	var blobs, items int64
	if err := f.server.DB.Model(&meta.ContentBlob{}).
		Where("sha256 = ?", f.stage.ContentSHA256).Count(&blobs).Error; err != nil || blobs != 0 {
		t.Fatalf("physical prerequisite created canonical metadata: count=%d err=%v", blobs, err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("physical prerequisite created source item: count=%d err=%v", items, err)
	}
	var source meta.Source
	if err := f.server.DB.Where("id = ?", f.source.ID).Take(&source).Error; err != nil ||
		source.Status != meta.SourceStatusPaused || source.Revision != f.source.Revision {
		t.Fatalf("physical preparation activated Source: %+v err=%v", source, err)
	}
}

func TestLocalPushNewCASPrecommitRejectsExistingBlobBeforePhysicalWork(t *testing.T) {
	f := makeLocalPushExistingCASTestFixture(t)
	called := false
	ok, err := f.server.prepareBoundLocalPushNewCASWithMaterializer(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		func(context.Context, string, string, int64) (bool, bool, error) {
			called = true
			return true, true, nil
		},
	)
	if ok || err == nil || called {
		t.Fatalf("existing referenced CAS bypassed ownership: ok=%t err=%v materialized=%t", ok, err, called)
	}
}

func TestLocalPushNewCASPrecommitRejectsForeignDeviceAndStaleStage(t *testing.T) {
	f := makeLocalPushNewCASPrecommitFixture(t)
	called := false
	physical := func(context.Context, string, string, int64) (bool, bool, error) {
		called = true
		return true, true, nil
	}
	f.ctx.Set(localSourceExecutorContextKey, localSourceExecutorProof{
		DeviceID: uuid.NewString(), RootID: f.proof.RootID,
		SourceRevision: f.proof.SourceRevision,
	})
	if ok, err := f.server.prepareBoundLocalPushNewCASWithMaterializer(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID, physical,
	); ok || !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) || called {
		t.Fatalf("foreign device selected native Stage: ok=%t err=%v called=%t", ok, err, called)
	}
	f.ctx.Set(localSourceExecutorContextKey, f.proof)
	f.ctx.Request.Header.Set("X-XDrive-Device-Token", "forged-foreign-credential")
	if ok, err := f.server.prepareBoundLocalPushNewCASWithMaterializer(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID, physical,
	); ok || err == nil || called {
		t.Fatalf("forged credential selected native Stage: ok=%t err=%v called=%t", ok, err, called)
	}
	f.ctx.Request.Header.Set("X-XDrive-Device-Token", "local-precommit-owning-device-test-secret")
	if ok, err := f.server.prepareBoundLocalPushNewCASWithMaterializer(
		f.ctx, f.source.ID, 7, f.proof, uuid.NewString(), physical,
	); ok || err == nil || called {
		t.Fatalf("wrong Stage id selected native bytes: ok=%t err=%v called=%t", ok, err, called)
	}
	if err := f.server.DB.Model(&meta.LocalPushStaging{}).
		Where("source_id = ?", f.source.ID).Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if ok, err := f.server.prepareBoundLocalPushNewCASWithMaterializer(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID, physical,
	); ok || err == nil || called {
		t.Fatalf("expired Stage selected native bytes: ok=%t err=%v called=%t", ok, err, called)
	}
}

func TestLocalPushNewCASPrecommitFailsOnMidflightRevokeStageOrRevision(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(localPushExistingCASTestFixture) error
	}{
		{"revoke", func(f localPushExistingCASTestFixture) error {
			now := time.Now().UTC()
			return f.server.DB.Model(&meta.ClientDevice{}).
				Where("id = ?", f.device.ID).Update("revoked_at", &now).Error
		}},
		{"stage cancel", func(f localPushExistingCASTestFixture) error {
			return f.server.DB.Model(&meta.LocalPushStaging{}).
				Where("source_id = ?", f.source.ID).Update("status", localPushStageCanceled).Error
		}},
		{"source revision", func(f localPushExistingCASTestFixture) error {
			return f.server.DB.Model(&meta.Source{}).
				Where("id = ?", f.source.ID).Update("revision", 8).Error
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := makeLocalPushNewCASPrecommitFixture(t)
			called := 0
			ok, err := f.server.prepareBoundLocalPushNewCASWithMaterializer(
				f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
				func(context.Context, string, string, int64) (bool, bool, error) {
					called++
					return true, true, test.change(f)
				},
			)
			if ok || err == nil || called != 1 {
				t.Fatalf("midflight %s was accepted: ok=%t err=%v called=%d", test.name, ok, err, called)
			}
		})
	}
}

func TestLocalPushNewCASPrecommitBusyAndCancellationCannotAuthorizeCommit(t *testing.T) {
	f := makeLocalPushNewCASPrecommitFixture(t)
	if ok, err := f.server.prepareBoundLocalPushNewCASWithMaterializer(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
		func(context.Context, string, string, int64) (bool, bool, error) {
			return false, false, nil
		},
	); ok || err != nil {
		t.Fatalf("busy OS shard reported a success: ok=%t err=%v", ok, err)
	}
	canceled, cancel := context.WithCancel(context.Background())
	f.ctx.Request = f.ctx.Request.WithContext(canceled)
	if ok, err := f.server.prepareBoundLocalPushNewCASWithMaterializer(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
		func(context.Context, string, string, int64) (bool, bool, error) {
			cancel()
			return true, true, nil
		},
	); ok || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled request authorized a commit: ok=%t err=%v", ok, err)
	}
}
