package api

import (
	"context"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// A/B builds the original and candidate production media.go against the SAME
// test sources. Never replay Owner parameters or original SQL to artifacts.
// PostgreSQL17 is disposable, seeded once using the merged #2851 fixture.
// This is a Go/GORM query performance probe, not live Baidu conversion.
func TestPlacesBD09Owner95kCameraFirstPageCountAB(t *testing.T) {
	if os.Getenv("XD_PLACES_BD09_COUNT_AB") != "1" {
		t.Skip("requires opt-in disposable PostgreSQL17 matched Camera Count A/B")
	}
	if os.Getenv("XD_PLACES_100K_DISPOSABLE_CI") != "1" {
		t.Fatal("refusing non-disposable 95k Owner map experiment")
	}
	arm := os.Getenv("XD_PLACES_BD09_AB_ARM")
	if arm != "before" && arm != "after" {
		t.Fatal("expected explicit before/after source arm")
	}
	sourceSHA := os.Getenv("XD_PLACES_BD09_AB_HEAD")
	if !regexp.MustCompile(`^[0-9a-f]{40}$`).MatchString(sourceSHA) {
		t.Fatal("missing source-exact PR commit")
	}
	db := placesOverview100KDatabase(t, false)
	var owner meta.User
	if err := db.Where("username = ?", "places-perf-owner").First(&owner).Error; err != nil || owner.ID == 0 {
		t.Fatal("seeded Owner account unavailable")
	}
	bounds := baiduPhotoMapBounds{
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
		West:            118, South: 28, East: 123, North: 33,
	}
	capture := &placesBD09PlanCapture{Interface: logger.Default.LogMode(logger.Silent)}
	scoped := db.Session(&gorm.Session{Logger: capture})
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	start := time.Now()
	first, err := (&Server{DB: scoped}).queryMediaItemRange(
		ctx, owner.ID, mediaQueryOptions{BaiduViewport: &bounds}, "", 48, 0)
	elapsedMS := float64(time.Since(start).Microseconds()) / 1000
	cancel()
	if err != nil || first.TotalCount != 95000 || len(first.Items) != 48 {
		t.Fatalf("first Owner Camera Range invalid: count=%d items=%d", first.TotalCount, len(first.Items))
	}
	if first.TimelineGroupSets == nil || len(first.TimelineGroupSets.Day) == 0 {
		t.Fatal("first Owner Camera Range lost exact chronological day groups")
	}
	var dayTotal int64
	for _, day := range first.TimelineGroupSets.Day {
		if day.ItemCount <= 0 || day.StartIndex != dayTotal {
			t.Fatal("first Owner Camera date groups do not partition one exact Range")
		}
		dayTotal += day.ItemCount
	}
	if dayTotal != first.TotalCount {
		t.Fatal("Camera first-page group cardinality differs from signed Owner Count")
	}
	capture.mu.Lock()
	statements := append([]string(nil), capture.statements...)
	capture.mu.Unlock()
	var standaloneCount, groupedCount, orderedPage int
	for _, statement := range statements {
		lower := strings.ToLower(statement)
		if strings.Contains(lower, "count(") && !strings.Contains(lower, "group by") {
			standaloneCount++
		}
		if strings.Contains(lower, "count(") && strings.Contains(lower, "group by") {
			groupedCount++
		}
		if strings.Contains(lower, "order by") && strings.Contains(lower, "limit ") {
			orderedPage++
		}
	}
	expectedStatements, expectedStandalone := 3, 1
	if arm == "after" {
		expectedStatements, expectedStandalone = 2, 0
	}
	if len(statements) != expectedStatements || standaloneCount != expectedStandalone ||
		groupedCount != 1 || orderedPage != 1 {
		// Log counts only; never disclose original SELECT or bound Owner IDs.
		t.Fatalf("%s SQL phases differ: queries=%d standalone=%d groups=%d page=%d",
			arm, len(statements), standaloneCount, groupedCount, orderedPage)
	}
	// Subsequent sparse pages must STILL run the original independent
	// authorization-scoped Count, rather than reusing day groups from page 1.
	nextContext, stop := context.WithTimeout(context.Background(), 12*time.Second)
	next, nextErr := (&Server{DB: db}).queryMediaItemRange(
		nextContext, owner.ID, mediaQueryOptions{BaiduViewport: &bounds}, "", 48, 48)
	stop()
	if nextErr != nil || next.TotalCount != 95000 || len(next.Items) != 48 {
		t.Fatal("second-page Count/Range contract changed")
	}
	seen := make(map[uint64]struct{}, len(first.Items))
	for _, item := range first.Items {
		if item.Node.ID == 0 {
			t.Fatal("zero Owner Node in first page")
		}
		seen[item.Node.ID] = struct{}{}
	}
	if len(seen) != 48 {
		t.Fatal("first page returned duplicate Owner Nodes")
	}
	for _, item := range next.Items {
		if item.Node.ID == 0 {
			t.Fatal("zero Owner Node in next page")
		}
		if _, duplicate := seen[item.Node.ID]; duplicate {
			t.Fatal("sparse Owner Camera page overlaps the previous page")
		}
	}
	receipt := map[string]any{
		"arm":                          arm,
		"ci_git_head":                  sourceSHA,
		"workload":                     "owner100k_two_cities_95k_camera_gallery_range",
		"owner_assets":                 100000,
		"camera_count":                 first.TotalCount,
		"timeline_count":               dayTotal,
		"items":                        len(first.Items),
		"next_items":                   len(next.Items),
		"latency_ms":                   elapsedMS,
		"first_page_sql_count":         len(statements),
		"standalone_count_sql":         standaloneCount,
		"group_sql":                    groupedCount,
		"page_sql":                     orderedPage,
		"provider_conversion_verified": false,
	}
	data, marshalErr := json.Marshal(receipt)
	if marshalErr != nil {
		t.Fatal("A/B sample encoding failed")
	}
	t.Logf("PLACES_BD09_FIRST_PAGE_COUNT_AB %s", data)
}
