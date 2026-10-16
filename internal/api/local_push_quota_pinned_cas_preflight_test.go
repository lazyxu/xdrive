package api

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func makeLocalPushQuotaPinnedFixture(t *testing.T) localPushExistingCASTestFixture {
	t.Helper()
	f := makeLocalPushPinnedSQLFixture(t)
	if err := f.server.DB.AutoMigrate(&meta.FileVersion{}, &meta.UploadSession{}, &meta.LocalPushQuotaHold{}); err != nil {
		t.Fatal(err)
	}
	return f
}

func setLocalPushQuotaFixture(t *testing.T, f localPushExistingCASTestFixture, quota int64) {
	t.Helper()
	if err := f.server.DB.Model(&meta.User{}).
		Where("id = ?", f.device.OwnerID).Update("quota_bytes", quota).Error; err != nil {
		t.Fatal(err)
	}
}

func TestLocalPushQuotaPinnedSQLRejectsOverQuotaBeforePhysicalAdmission(t *testing.T) {
	f := makeLocalPushQuotaPinnedFixture(t)
	size := int64(len(f.body))
	setLocalPushQuotaFixture(t, f, size-1)
	called := false
	ok, err := f.server.inspectQuarantinedBoundLocalPushCASPinnedSQLWithReaderAndQuota(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
		func(context.Context, string, string, int64, func(context.Context) error) (bool, error) {
			called = true
			return true, nil
		}, true,
	)
	var quotaErr *quotaExceededError
	if ok || !errors.As(err, &quotaErr) || called || quotaErr.Additional != size {
		t.Fatalf("over-quota candidate reached physical phase: ok=%t err=%v called=%t", ok, err, called)
	}

	setLocalPushQuotaFixture(t, f, size)
	sqlDB, err := f.server.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if ok, err := f.server.inspectQuarantinedBoundLocalPushCASQuotaPinnedSQL(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
	); err != nil || !ok {
		t.Fatalf("exactly-at-quota physical inspection failed: ok=%t err=%v", ok, err)
	}
	setLocalPushQuotaFixture(t, f, 0)
	if ok, err := f.server.inspectQuarantinedBoundLocalPushCASQuotaPinnedSQL(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
	); err != nil || !ok {
		t.Fatalf("unlimited-quota read-only inspection failed: ok=%t err=%v", ok, err)
	}
	var blobs, items, runs int64
	if err := f.server.DB.Model(&meta.ContentBlob{}).Count(&blobs).Error; err != nil || blobs != 0 {
		t.Fatalf("quota read wrote ContentBlob: count=%d err=%v", blobs, err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("quota read wrote SourceItem: count=%d err=%v", items, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("quota read started SourceRun: count=%d err=%v", runs, err)
	}
	var source meta.Source
	if err := f.server.DB.Where("id = ?", f.source.ID).Take(&source).Error; err != nil ||
		source.Status != meta.SourceStatusPaused {
		t.Fatalf("quota preflight activated Push: source=%+v err=%v", source, err)
	}
}

func TestLocalPushQuotaPinnedSQLAccountsForActiveUploadReservations(t *testing.T) {
	f := makeLocalPushQuotaPinnedFixture(t)
	const reserved int64 = 17
	size := int64(len(f.body))
	session := meta.UploadSession{
		ID: uuid.NewString(), OwnerID: f.device.OwnerID,
		TotalSize: reserved, ChunkSize: reserved, ChunkCount: 1,
		Status: meta.UploadStatusActive, QuotaReservedBytes: reserved,
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	if err := f.server.DB.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	setLocalPushQuotaFixture(t, f, size+reserved-1)
	if ok, err := f.server.inspectQuarantinedBoundLocalPushCASQuotaPinnedSQL(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
	); ok || err == nil {
		t.Fatalf("existing upload reservation was ignored: ok=%t err=%v", ok, err)
	}
	setLocalPushQuotaFixture(t, f, size+reserved)
	if ok, err := f.server.inspectQuarantinedBoundLocalPushCASQuotaPinnedSQL(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
	); !ok || err != nil {
		t.Fatalf("reservation boundary rejected exact capacity: ok=%t err=%v", ok, err)
	}
	if err := f.server.DB.Model(&meta.UploadSession{}).
		Where("id = ?", session.ID).Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	setLocalPushQuotaFixture(t, f, size)
	if ok, err := f.server.inspectQuarantinedBoundLocalPushCASQuotaPinnedSQL(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
	); !ok || err != nil {
		t.Fatalf("expired reservation was not excluded: ok=%t err=%v", ok, err)
	}
}

func TestLocalPushQuotaPinnedSQLRejectsOwnerReferenceMissingContentBlob(t *testing.T) {
	f := makeLocalPushQuotaPinnedFixture(t)
	// A canonical key referenced by a File but lacking ContentBlob metadata
	// is inconsistent, even when quota is unlimited. Never treat it as free
	// deduplication or grant an authoritative new-content commit.
	node := meta.Node{
		OwnerID: f.device.OwnerID, ParentID: f.source.TargetNodeID,
		Name: "inconsistent-blob-reference.bin", Type: meta.NodeTypeFile, Revision: 1,
	}
	if err := f.server.DB.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Create(&meta.File{
		NodeID: node.ID, Size: int64(len(f.body)),
		StorageKey: f.casKey, SHA256: f.stage.ContentSHA256,
	}).Error; err != nil {
		t.Fatal(err)
	}
	called := false
	if ok, err := f.server.inspectQuarantinedBoundLocalPushCASPinnedSQLWithReaderAndQuota(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
		func(context.Context, string, string, int64, func(context.Context) error) (bool, error) {
			called = true
			return true, nil
		}, true,
	); ok || !errors.Is(err, errLocalPushStageConflict) || called {
		t.Fatalf("orphan canonical reference received quota approval: ok=%t err=%v called=%t", ok, err, called)
	}
}

func TestLocalPushQuotaPinnedSQLRejectsForeignCredentialAndReleasesQuotaLock(t *testing.T) {
	f := makeLocalPushQuotaPinnedFixture(t)
	size := int64(len(f.body))
	setLocalPushQuotaFixture(t, f, size)
	f.ctx.Request.Header.Set("X-XDrive-Device-Token", "wrong-second-desktop-token")
	if ok, err := f.server.inspectQuarantinedBoundLocalPushCASQuotaPinnedSQL(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
	); ok || err == nil {
		t.Fatalf("foreign Desktop admitted under owner quota: ok=%t err=%v", ok, err)
	}
	f.ctx.Request.Header.Set("X-XDrive-Device-Token", "local-precommit-owning-device-test-secret")
	// Failure must release the user-row lock. A subsequent independent
	// transaction can edit this user's quota and allow the same owner proof.
	if err := f.server.DB.Transaction(func(tx *gorm.DB) error {
		return tx.Model(&meta.User{}).
			Where("id = ?", f.device.OwnerID).Update("quota_bytes", size+1).Error
	}); err != nil {
		t.Fatalf("denied inspector retained quota lock: %v", err)
	}
	if ok, err := f.server.inspectQuarantinedBoundLocalPushCASQuotaPinnedSQL(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
	); !ok || err != nil {
		t.Fatalf("owner did not recover after denied foreign call: ok=%t err=%v", ok, err)
	}
}

func TestLocalPushQuotaPinnedSQLCannotReserveQuotaOrProvideCommitAuthority(t *testing.T) {
	f := makeLocalPushQuotaPinnedFixture(t)
	setLocalPushQuotaFixture(t, f, int64(len(f.body)))
	if ok, err := f.server.inspectQuarantinedBoundLocalPushCASQuotaPinnedSQL(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
	); !ok || err != nil {
		t.Fatalf("quota physical inspection rejected: ok=%t err=%v", ok, err)
	}
	// Rechecking without reserving deliberately permits another inspection.
	// There is NO quota booking, terminal Stage status or successful backup.
	if ok, err := f.server.inspectQuarantinedBoundLocalPushCASQuotaPinnedSQL(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
	); !ok || err != nil {
		t.Fatalf("ephemeral quota read changed canonical state: ok=%t err=%v", ok, err)
	}
	var stage meta.LocalPushStaging
	if err := f.server.DB.Where("source_id = ?", f.source.ID).Take(&stage).Error; err != nil ||
		stage.Status != localPushStageReady {
		t.Fatalf("quota preflight mutated Stage status: status=%s err=%v", stage.Status, err)
	}
	var intent meta.LocalPushCASPrepareIntent
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&intent).Error; err != nil ||
		intent.State != meta.LocalPushCASPrepareIntentQuarantined {
		t.Fatalf("quota preflight changed quarantine: state=%s err=%v", intent.State, err)
	}
}
