package api

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

// This opt-in test samples the genuine 95k Owner BD09 camera Gallery SQL
// only on the repository's disposable PostgreSQL17 100k fixture. It does
// not claim that an HTTP browser signal, real provider or iPhone was tested.
func TestPlacesBD09Owner95kActivePostgresCancellation(t *testing.T) {
	if os.Getenv("XD_PLACES_BD09_CANCEL_ACTIVE") != "1" {
		t.Skip("requires opt-in disposable 95k BD09 Postgres cancellation fixture")
	}
	if os.Getenv("XD_PLACES_100K_DISPOSABLE_CI") != "1" {
		t.Fatal("cannot run 95k cancellation probe against production")
	}
	head := os.Getenv("XD_PLACES_BD09_HEAD")
	if !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(head) {
		t.Fatal("exact source HEAD required")
	}
	db := placesOverview100KDatabase(t, false)
	var owner meta.User
	if err := db.Where("username = ?", "places-perf-owner").First(&owner).Error; err != nil ||
		owner.ID == 0 {
		t.Fatal("disposable 100k Owner not found")
	}
	bounds := baiduPhotoMapBounds{
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
		West: 118, South: 28, East: 123, North: 33,
	}
	type returnResult struct {
		cancelled bool
	}
	samples := make([]map[string]any, 0, 3)
	for i := 1; i <= 3; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
		done := make(chan returnResult, 1)
		go func() {
			page, err := (&Server{DB: db}).queryMediaItemRange(ctx, owner.ID,
				mediaQueryOptions{BaiduViewport: &bounds}, "", 48, 0)
			done <- returnResult{cancelled: err != nil && page.TotalCount == 0 &&
				len(page.Items) == 0}
		}()
		// A PRE-cancelled context is not a query-cancellation test. Require a
		// live original SELECT from the source-fenced BD09 positions table.
		// Explicitly exclude this monitor from its own activity predicate.
		const activeSQL = "SELECT count(*) FROM pg_stat_activity WHERE state='active' AND datname=current_database() AND pid<>pg_backend_pid() AND query LIKE '%xd_baidu_photo_map_positions%' AND query NOT LIKE '%pg_stat_activity%'"
		active := int64(0)
		deadline := time.Now().Add(5*time.Second)
		for active == 0 && time.Now().Before(deadline) {
			select {
			case <-done:
				cancel()
				t.Fatalf("sample %d ended before a running Owner camera SQL was observed", i)
			default:
			}
			pollCtx, stop := context.WithTimeout(context.Background(), 500*time.Millisecond)
			err := db.WithContext(pollCtx).Raw(activeSQL).Scan(&active).Error
			stop()
			if err != nil {
				cancel()
				t.Fatalf("sample %d activity inspection failed", i)
			}
			if active == 0 {
				time.Sleep(5 * time.Millisecond)
			}
		}
		if active == 0 {
			cancel()
			t.Fatalf("sample %d did not observe in-flight production Owner camera SQL", i)
		}
		start := time.Now()
		cancel()
		select {
		case outcome := <-done:
			if !outcome.cancelled || ctx.Err() != context.Canceled {
				t.Fatalf("sample %d returned usable old Owner camera data after cancellation", i)
			}
		case <-time.After(1500 * time.Millisecond):
			t.Fatalf("sample %d did not finish promptly after Go Context cancellation", i)
		}
		elapsedMS := float64(time.Since(start).Microseconds()) / 1000
		samples = append(samples, map[string]any{
			"ordinal": i, "observed_active_postgres_select": true,
			"old_owner_range_rejected": true,
			"go_cancel_return_ms": elapsedMS,
		})
	}
	// A terminated query must never poison the original Owner/source scope:
	// the next independent read still returns exactly the 95k/48-camera page.
	freshCtx, stop := context.WithTimeout(context.Background(), 8*time.Second)
	page, err := (&Server{DB: db}).queryMediaItemRange(freshCtx, owner.ID,
		mediaQueryOptions{BaiduViewport: &bounds}, "", 48, 0)
	stop()
	if err != nil || page.TotalCount != 95000 || len(page.Items) != 48 {
		t.Fatal("95k Owner Camera Range was not recoverable after in-flight cancel")
	}
	output := os.Getenv("XD_PLACES_BD09_CANCEL_OUTPUT")
	if output == "" {
		t.Fatal("redacted test output file is required")
	}
	report := map[string]any{
		"ci_git_head": head, "owner_assets": 100000,
		"sample_count": len(samples), "samples": samples,
		"fresh_camera_count": page.TotalCount,
		"fresh_page_items": len(page.Items),
		"fixture": "disposable PG17 original production Owner query; synthetic BD09 positions",
		"provider_conversion_verified": false,
		"browser_abort_verified": false,
	}
	bytes, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal("could not encode sanitized cancellation metrics")
	}
	if err := os.MkdirAll(filepath.Dir(output), 0755); err != nil {
		t.Fatal("cannot create sanitized output directory")
	}
	if err := os.WriteFile(output, append(bytes, '\n'), 0644); err != nil {
		t.Fatal("cannot write sanitized cancellation report")
	}
	t.Logf("PLACES_BD09_ACTIVE_CANCEL source=%s samples=%d restored_count=%d",
		head, len(samples), page.TotalCount)
}
