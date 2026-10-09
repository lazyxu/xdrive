package api

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
	"gorm.io/gorm"
)

// TestPhotoAssetOwnerReconcilePerformance100K measures the first remaining
// owner-wide failure after bounded Node/File preload. It is NOT a successful
// end-to-end 100k throughput benchmark when PostgreSQL rejects an oversized IN.
// Real 15k Live Photo groups and their two physical resources are in the fixture.
func TestPhotoAssetOwnerReconcilePerformance100K(t *testing.T) {
	writeDiagnostic := os.Getenv("XD_PHOTOASSET_OWNER_WRITE_DIAGNOSTIC") == "1"
	if os.Getenv("XD_PHOTOASSET_OWNER_RECONCILE_PERF") != "1" && !writeDiagnostic {
		t.Skip("set XD_PHOTOASSET_OWNER_RECONCILE_PERF=1 for native PostgreSQL full 100k owner reconciliation")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}

	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.AuditEvent{}, &meta.Source{}, &meta.SourceItem{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{}, &meta.PhotoAsset{},
		&meta.PhotoResource{}, &meta.PhotoMetadata{}, &meta.PhotoEditRecipe{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}
	user := meta.User{
		Username:     "photoasset-owner-reconcile-100k",
		PasswordHash: "unused-performance-fixture",
		Role:         meta.UserRoleUser,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	folder := meta.Node{
		Name:     "100k PhotoAsset reconciliation",
		Type:     meta.NodeTypeDir,
		OwnerID:  user.ID,
		Revision: 1,
	}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	seedStart := time.Now()
	mediaGallerySeedFirstOpen100K(t, db, user.ID, folder.ID)
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000

	count := func(model any, byOwner bool) int64 {
		t.Helper()
		q := db.Model(model)
		if byOwner {
			q = q.Where("owner_id = ?", user.ID)
		}
		var n int64
		if err := q.Count(&n).Error; err != nil {
			t.Fatal(err)
		}
		return n
	}
	beforeAssets := count(&meta.PhotoAsset{}, true)
	beforeResources := count(&meta.PhotoResource{}, false)
	beforeMediaNodes := count(&meta.MediaMetadata{}, true)
	beforeLiveGroups := count(&meta.MediaGroup{}, true)
	beforeMemberships := count(&meta.PhotoCollectionAsset{}, false)
	if beforeAssets != mediaGalleryFirstOpenLogicalCount ||
		beforeResources != mediaGalleryFirstOpenPhysical ||
		beforeMediaNodes != mediaGalleryFirstOpenPhysical ||
		beforeLiveGroups != mediaGalleryFirstOpenLivePhotos ||
		beforeMemberships != mediaGalleryFirstOpenLogicalCount {
		t.Fatalf("invalid fixture assets=%d resources=%d media_nodes=%d live_groups=%d memberships=%d",
			beforeAssets, beforeResources, beforeMediaNodes, beforeLiveGroups, beforeMemberships)
	}

	// Diagnostic mode is a measurement-only cutoff, not an acceptance budget
	// for a successful 100k reconciliation.
	reconcileLimit := 120 * time.Second
	var assetUpdates, resourceDeletes, resourceCreates, metadataUpserts atomic.Int64
	if writeDiagnostic {
		reconcileLimit = 60 * time.Second
		if err := db.Callback().Update().After("gorm:update").Register("perf:owner-asset-update", func(tx *gorm.DB) {
			if tx.Statement.Table == "xd_photo_assets" {
				assetUpdates.Add(1)
			}
		}); err != nil {
			t.Fatal(err)
		}
		if err := db.Callback().Delete().After("gorm:delete").Register("perf:owner-resource-delete", func(tx *gorm.DB) {
			if tx.Statement.Table == "xd_photo_resources" {
				resourceDeletes.Add(1)
			}
		}); err != nil {
			t.Fatal(err)
		}
		if err := db.Callback().Create().After("gorm:create").Register("perf:owner-create-count", func(tx *gorm.DB) {
			switch tx.Statement.Table {
			case "xd_photo_resources":
				resourceCreates.Add(1)
			case "xd_photo_metadata":
				metadataUpserts.Add(1)
			}
		}); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), reconcileLimit)
	start := time.Now()
	report, reconcileErr := photoasset.ReconcileOwner(ctx, db, user.ID)
	elapsedMS := float64(time.Since(start).Microseconds()) / 1000
	contextErr := ctx.Err()
	cancel()
	sqlWrites := assetUpdates.Load() + resourceDeletes.Load() + resourceCreates.Load() + metadataUpserts.Load()

	afterAssets := count(&meta.PhotoAsset{}, true)
	afterResources := count(&meta.PhotoResource{}, false)
	afterLiveGroups := count(&meta.MediaGroup{}, true)
	afterMemberships := count(&meta.PhotoCollectionAsset{}, false)
	errorText := ""
	if reconcileErr != nil {
		errorText = reconcileErr.Error()
	}
	contextError := ""
	if contextErr != nil {
		contextError = contextErr.Error()
	}
	overflow := reconcileErr != nil && strings.Contains(errorText, "65535")
	result := map[string]any{
		"workload":                "photoasset-owner-full-reconcile-100k",
		"logical_assets":          mediaGalleryFirstOpenLogicalCount,
		"physical_media_nodes":    mediaGalleryFirstOpenPhysical,
		"live_photo_groups":       mediaGalleryFirstOpenLivePhotos,
		"seed_ms":                 seedMS,
		"reconcile_elapsed_ms":    elapsedMS,
		"success":                 reconcileErr == nil,
		"write_diagnostic":        writeDiagnostic,
		"reconcile_deadline_ms":   reconcileLimit.Milliseconds(),
		"asset_update_callbacks":  assetUpdates.Load(),
		"resource_deletes":        resourceDeletes.Load(),
		"resource_creates":        resourceCreates.Load(),
		"metadata_upserts":        metadataUpserts.Load(),
		"observed_write_calls":    sqlWrites,
		"bind_parameter_overflow": overflow,
		"error":                   errorText,
		"context_error":           contextError,
		"before_assets":           beforeAssets,
		"after_assets":            afterAssets,
		"before_resources":        beforeResources,
		"after_resources":         afterResources,
		"before_live_groups":      beforeLiveGroups,
		"after_live_groups":       afterLiveGroups,
		"before_memberships":      beforeMemberships,
		"after_memberships":       afterMemberships,
		"report_assets":           report.Assets,
		"report_resources":        report.Resources,
		"report_collections":      report.Collections,
		"report_memberships":      report.Memberships,
		"scope":                   "native PostgreSQL full owner reconcile; fixture already projected; no remote Store, media codec, HTTP or UI",
	}
	raw, marshalErr := json.Marshal(result)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	t.Logf("PHOTOASSET_OWNER_RECONCILE_100K %s", raw)

	if reconcileErr != nil {
		if writeDiagnostic {
			timedOut := errors.Is(contextErr, context.DeadlineExceeded) ||
				errors.Is(reconcileErr, context.DeadlineExceeded)
			if !timedOut || sqlWrites < 1000 {
				t.Fatalf("unexpected write diagnostic error after %.3f ms, sql_calls=%d: %v (ctx=%s)",
					elapsedMS, sqlWrites, reconcileErr, contextError)
			}
		} else if !overflow {
			t.Fatalf("unexpected owner reconciliation failure after %.3f ms: %v (ctx=%s)", elapsedMS, reconcileErr, contextError)
		}
		if beforeAssets != afterAssets || beforeResources != afterResources ||
			beforeLiveGroups != afterLiveGroups || beforeMemberships != afterMemberships {
			t.Fatalf("failed transaction modified fixture: assets=%d->%d resources=%d->%d live=%d->%d membership=%d->%d",
				beforeAssets, afterAssets, beforeResources, afterResources, beforeLiveGroups, afterLiveGroups,
				beforeMemberships, afterMemberships)
		}
		return
	}
	if report.Assets != mediaGalleryFirstOpenLogicalCount ||
		report.Resources != mediaGalleryFirstOpenPhysical ||
		report.Collections != 1 ||
		report.Memberships != mediaGalleryFirstOpenLogicalCount ||
		afterAssets != beforeAssets ||
		afterResources != beforeResources ||
		afterLiveGroups != beforeLiveGroups ||
		afterMemberships != beforeMemberships {
		t.Fatalf("successful owner reconciliation changed expected cardinality: report=%+v assets=%d resources=%d live=%d membership=%d",
			report, afterAssets, afterResources, afterLiveGroups, afterMemberships)
	}
}
