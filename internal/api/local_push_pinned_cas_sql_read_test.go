package api

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

func makeLocalPushPinnedSQLFixture(t *testing.T) localPushExistingCASTestFixture {
	t.Helper()
	f := makeLocalPushCASPrepareIntentFixture(t)
	if created, err := f.quarantineNewCAS(); err != nil || !created {
		t.Fatalf("cannot stage durable quarantine: created=%t err=%v", created, err)
	}
	created, admitted, err := f.local.MaterializeLocalPushStageCAS(
		context.Background(), f.stageKey, f.casKey, int64(len(f.body)),
	)
	if err != nil || !created || !admitted {
		t.Fatalf("cannot publish unreferenced physical CAS: created=%t admitted=%t err=%v", created, admitted, err)
	}
	return f
}

func TestLocalPushPinnedSQLOwnAgentReadsRealCASWithNoAuthoritativeWrites(t *testing.T) {
	f := makeLocalPushPinnedSQLFixture(t)
	// One connection proves this path never grabs a second pooled SQL
	// connection while holding the owning Source/CAS hash transaction locks.
	sqlDB, err := f.server.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if ok, err := f.server.inspectQuarantinedBoundLocalPushCASPinnedSQL(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
	); err != nil || !ok {
		t.Fatalf("single-connection real physical/SQL inspection failed: ok=%t err=%v", ok, err)
	}
	var blobCount, itemCount, runCount int64
	if err := f.server.DB.Model(&meta.ContentBlob{}).Count(&blobCount).Error; err != nil || blobCount != 0 {
		t.Fatalf("read gate persisted CAS reference: %d err=%v", blobCount, err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).Where("source_id = ?", f.source.ID).
		Count(&itemCount).Error; err != nil || itemCount != 0 {
		t.Fatalf("read gate persisted SourceItem: %d err=%v", itemCount, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).Where("source_id = ?", f.source.ID).
		Count(&runCount).Error; err != nil || runCount != 0 {
		t.Fatalf("read gate created SourceRun: %d err=%v", runCount, err)
	}
	var source meta.Source
	if err := f.server.DB.Where("id = ?", f.source.ID).Take(&source).Error; err != nil ||
		source.Status != meta.SourceStatusPaused {
		t.Fatalf("read gate activated local Push: %+v err=%v", source, err)
	}
	if err := f.local.DeleteStaging(context.Background(), f.stageKey); err != nil {
		t.Fatalf("successful SQL/OS gate leaked Stage shard: %v", err)
	}
	if err := f.local.Delete(context.Background(), f.casKey); err != nil {
		t.Fatalf("successful SQL/OS gate leaked CAS shard: %v", err)
	}
}

func TestLocalPushPinnedSQLRejectsNonOwnerOrBadStageBeforePhysicalReader(t *testing.T) {
	for _, variant := range []string{"foreign", "forged", "quarantine", "stage", "blob"} {
		t.Run(variant, func(t *testing.T) {
			f := makeLocalPushPinnedSQLFixture(t)
			switch variant {
			case "foreign":
				f.ctx.Set(localSourceExecutorContextKey, localSourceExecutorProof{
					DeviceID: uuid.NewString(), RootID: f.proof.RootID, SourceRevision: 7,
				})
			case "forged":
				f.ctx.Request.Header.Set("X-XDrive-Device-Token", "foreign-credential")
			case "quarantine":
				if err := f.server.DB.Model(&meta.LocalPushCASPrepareIntent{}).
					Where("stage_id = ?", f.stage.StageID).Update("state", "invalid").Error; err != nil {
					t.Fatal(err)
				}
			case "stage":
				if err := f.server.DB.Model(&meta.LocalPushStaging{}).
					Where("source_id = ?", f.source.ID).Update("status", localPushStageCanceled).Error; err != nil {
					t.Fatal(err)
				}
			case "blob":
				if err := f.server.DB.Create(&meta.ContentBlob{
					SHA256: f.stage.ContentSHA256, StorageKey: f.casKey,
					Size: int64(len(f.body)), RefCount: 0, State: meta.ContentBlobStateDeleting,
				}).Error; err != nil {
					t.Fatal(err)
				}
			}
			readerCalled := false
			ok, err := f.server.inspectQuarantinedBoundLocalPushCASPinnedSQLWithReader(
				f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
				func(context.Context, string, string, int64, func(context.Context) error) (bool, error) {
					readerCalled = true
					return true, nil
				},
			)
			if ok || err == nil || readerCalled {
				t.Fatalf("%s reached physical inspector: ok=%t err=%v called=%t",
					variant, ok, err, readerCalled)
			}
		})
	}
}

func TestLocalPushPinnedSQLBusyOrCanceledReaderRollsBackAndNeverCommits(t *testing.T) {
	for _, variant := range []string{"busy", "callback-error", "cancel"} {
		t.Run(variant, func(t *testing.T) {
			f := makeLocalPushPinnedSQLFixture(t)
			sentinel := errors.New("synthetic read-only observer rejected")
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if variant == "cancel" {
				f.ctx.Request = f.ctx.Request.WithContext(ctx)
			}
			ok, err := f.server.inspectQuarantinedBoundLocalPushCASPinnedSQLWithReader(
				f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
				func(held context.Context, stage, cas string, size int64,
					inside func(context.Context) error) (bool, error) {
					switch variant {
					case "busy":
						return false, nil
					case "callback-error":
						return false, sentinel
					case "cancel":
						cancel()
						return false, held.Err()
					}
					return false, sentinel
				},
			)
			switch variant {
			case "busy":
				if ok || err != nil {
					t.Fatalf("busy OS lock incorrectly admitted: ok=%t err=%v", ok, err)
				}
			case "callback-error":
				if ok || !errors.Is(err, sentinel) {
					t.Fatalf("callback failure admitted: ok=%t err=%v", ok, err)
				}
			case "cancel":
				if ok || !errors.Is(err, context.Canceled) {
					t.Fatalf("cancelled callback admitted: ok=%t err=%v", ok, err)
				}
			}
			// A fresh transaction must acquire the SAME CAS advisory hash
			// after the unsuccessful read gate rolls back. No leaked SQL lock.
			var available bool
			if err := f.server.DB.Raw(
				"SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0))",
				f.stage.ContentSHA256,
			).Scan(&available).Error; err != nil || !available {
				t.Fatalf("read gate retained CAS advisory lock: available=%t err=%v", available, err)
			}
		})
	}
}

func TestLocalPushPinnedSQLRejectsPhysicalSameSizeCASCorruption(t *testing.T) {
	f := makeLocalPushPinnedSQLFixture(t)
	full := filepath.Join(f.local.FilesystemRoot(), filepath.FromSlash(f.casKey))
	if err := os.WriteFile(full, bytes.Repeat([]byte{'x'}, len(f.body)), 0o600); err != nil {
		t.Fatal(err)
	}
	if ok, err := f.server.inspectQuarantinedBoundLocalPushCASPinnedSQL(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID,
	); ok || err == nil {
		t.Fatalf("same-size corrupt physical CAS produced successful SQL read: ok=%t err=%v", ok, err)
	}
	var available bool
	if err := f.server.DB.Raw(
		"SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0))",
		f.stage.ContentSHA256,
	).Scan(&available).Error; err != nil || !available {
		t.Fatalf("corrupt CAS left SQL hash lock: available=%t err=%v", available, err)
	}
	if err := f.local.DeleteStaging(context.Background(), f.stageKey); err != nil {
		t.Fatalf("physical corruption leaked Stage pin: %v", err)
	}
	if err := f.local.Delete(context.Background(), f.casKey); err != nil {
		t.Fatalf("physical corruption leaked CAS pin: %v", err)
	}
}
