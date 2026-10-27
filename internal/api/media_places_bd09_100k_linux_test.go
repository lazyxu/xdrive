package api

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"syscall"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// Linux-only, opt-in, source-exact PostgreSQL17 baseline. The 10k subset is
// scoped from a 100k Owner, NOT a separate 10k-owner production dataset.
// The deterministic BD09 coordinates are synthetic; no Provider accuracy,
// real media bytes, iOS device or production account is certified here.
type placesBD09Sample struct {
	Scope           string    `json:"scope"`
	Window          string    `json:"window"`
	Operation       string    `json:"operation"`
	Expected        int64     `json:"expected"`
	Count           int64     `json:"count"`
	MaximumReturned int       `json:"max_returned"`
	LatencyMS       []float64 `json:"latency_ms"`
	P50MS           float64   `json:"p50_ms"`
	P95MS           float64   `json:"p95_ms"`
	UserCPUms       float64   `json:"user_cpu_ms"`
	SystemCPUms     float64   `json:"system_cpu_ms"`
	PeakRSSKiB      int64     `json:"peak_rss_kib"`
}

func placesBD09ResourceSnapshot() (user, system float64, rss int64) {
	var r syscall.Rusage
	if syscall.Getrusage(syscall.RUSAGE_SELF, &r) != nil {
		return 0, 0, 0
	}
	return float64(r.Utime.Sec)*1000 + float64(r.Utime.Usec)/1000,
		float64(r.Stime.Sec)*1000 + float64(r.Stime.Usec)/1000, r.Maxrss
}

func placesBD09Measure(t *testing.T, db *gorm.DB, ownerID uint64,
	window string, bounds baiduPhotoMapBounds, expected int64,
	operation string, limitedTo10k bool) placesBD09Sample {
	t.Helper()
	out := placesBD09Sample{
		Scope: "owner100k", Window: window, Operation: operation,
		Expected: expected, LatencyMS: make([]float64, 0, 3),
	}
	if limitedTo10k {
		out.Scope = "owner100k_scoped_first10k_members"
	}
	startUser, startSystem, _ := placesBD09ResourceSnapshot()
	for sample := 0; sample < 3; sample++ {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		started := time.Now()
		var count int64
		var n int
		var err error
		switch operation {
		case "cells":
			var page baiduPhotoMapCellPage
			if limitedTo10k {
				members := db.WithContext(ctx).Table("xd_photo_assets").
					Select("primary_node_id").Where("owner_id = ?", ownerID).
					Order("id ASC").Limit(10000)
				page, err = queryBaiduPhotoMapCellsScoped(ctx, db, ownerID, bounds, members, mediaQueryOptions{})
			} else {
				page, err = queryBaiduPhotoMapCells(ctx, db, ownerID, bounds)
			}
			count, n = page.TotalCount, len(page.Items)
			for _, cell := range page.Items {
				if cell.AssetID == 0 || cell.NodeID == 0 || cell.NodeRevision == 0 || cell.PhotoCount <= 0 {
					err = fmt.Errorf("bad source-fenced Owner representative")
					break
				}
			}
		case "native_viewport":
			var page baiduPhotoMapPage
			page, err = queryBaiduPhotoMapViewport(ctx, db, ownerID, bounds, 48, 0)
			count, n = page.TotalCount, len(page.Items)
		case "camera_gallery_range":
			s := &Server{DB: db}
			page, queryErr := s.queryMediaItemRange(ctx, ownerID,
				mediaQueryOptions{BaiduViewport: &bounds}, "", 48, 0)
			err = queryErr
			count, n = page.TotalCount, len(page.Items)
		default:
			cancel()
			t.Fatalf("unrecognized performance operation %q", operation)
		}
		elapsedMS := float64(time.Since(started).Microseconds()) / 1000
		cancel()
		if err != nil || count != expected || n > 64 ||
			(expected > 0 && n == 0) || (expected == 0 && n != 0) {
			t.Fatalf("%s %s %s sample=%d count=%d expected=%d members=%d error=%v",
				out.Scope, window, operation, sample+1, count, expected, n, err)
		}
		out.Count = count
		if n > out.MaximumReturned {
			out.MaximumReturned = n
		}
		out.LatencyMS = append(out.LatencyMS, elapsedMS)
	}
	endUser, endSystem, maxRSS := placesBD09ResourceSnapshot()
	out.UserCPUms = endUser - startUser
	out.SystemCPUms = endSystem - startSystem
	out.PeakRSSKiB = maxRSS
	sorted := append([]float64(nil), out.LatencyMS...)
	sort.Float64s(sorted)
	out.P50MS, out.P95MS = sorted[1], sorted[2]
	raw, _ := json.Marshal(out)
	t.Logf("PLACES_BD09_OWNER_METRIC %s", raw)
	return out
}

func TestPlacesBD09Owner100kPostgresBaseline(t *testing.T) {
	if os.Getenv("XD_PLACES_BD09_PG100K") != "1" {
		t.Skip("requires disposable PostgreSQL17 100k BD09 benchmark opt-in")
	}
	action := os.Getenv("XD_PLACES_BD09_ACTION")
	if action != "seed" && action != "probe" {
		t.Fatalf("invalid BD09 benchmark action %q", action)
	}
	db := placesOverview100KDatabase(t, action == "seed")
	if action == "seed" {
		placesOverview100KSeed(t, db)
		if err := db.AutoMigrate(&meta.BaiduPhotoMapPosition{}); err != nil {
			t.Fatal(err)
		}
		// Real metadata and revision/Owner joins, but deterministic synthetic
		// BD09 offsets (NOT evidence of an actual Baidu Geoconv response).
		insert := db.Exec(`
INSERT INTO xd_baidu_photo_map_positions
(asset_id, owner_id, primary_node_id, node_revision, media_updated_at,
 consent_revision, source_latitude, source_longitude, coordinate_space,
 projection_version, latitude, longitude, created_at, updated_at)
SELECT pa.id, pa.owner_id, pa.primary_node_id, n.revision, mm.updated_at,
 0, mm.latitude, mm.longitude, ?, ?, mm.latitude + 0.003,
 mm.longitude + 0.005, now(), now()
FROM xd_photo_assets AS pa
JOIN xd_nodes AS n ON n.id = pa.primary_node_id AND n.owner_id = pa.owner_id
JOIN xd_media_metadata AS mm ON mm.node_id = n.id
 AND mm.owner_id = pa.owner_id AND mm.node_revision = n.revision
WHERE mm.index_state = ? AND mm.media_kind IN (?,?)
 AND mm.latitude IS NOT NULL AND mm.longitude IS NOT NULL`,
			meta.BaiduPhotoMapSpaceBD09LL, meta.BaiduPhotoMapProjectionGeoconvV2,
			meta.MediaIndexStateReady, meta.MediaKindImage, meta.MediaKindVideo)
		if insert.Error != nil || insert.RowsAffected != 100001 {
			t.Fatalf("source-fenced synthetic BD09 positions=%d want=100001 err=%v",
				insert.RowsAffected, insert.Error)
		}
		for _, table := range []string{"xd_baidu_photo_map_positions", "xd_nodes",
			"xd_photo_assets", "xd_media_metadata"} {
			if err := db.Exec("ANALYZE " + table).Error; err != nil {
				t.Fatal(err)
			}
		}
		t.Log("PLACES_BD09_SEEDED 100000 Owner positions + 1 foreign position, 115000 media rows")
		return
	}
	var owner, peer meta.User
	if err := db.Where("username = ?", "places-perf-owner").First(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("username = ?", "places-perf-foreign").First(&peer).Error; err != nil {
		t.Fatal(err)
	}
	world := baiduPhotoMapBounds{CoordinateSpace: "bd09ll",
		West: -180, South: -85, East: 180, North: 85}
	other, err := queryBaiduPhotoMapCells(context.Background(), db, peer.ID, world)
	if err != nil || other.TotalCount != 1 {
		t.Fatalf("cross-Owner source predicate failed: page=%+v err=%v", other, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := queryBaiduPhotoMapCells(ctx, db, owner.ID, world); err == nil {
		t.Fatal("cancelled Owner map Cells was accepted")
	}
	if _, err := queryBaiduPhotoMapViewport(ctx, db, owner.ID, world, 48, 0); err == nil {
		t.Fatal("cancelled native camera Viewport was accepted")
	}
	windows := []struct {
		name     string
		bounds   baiduPhotoMapBounds
		expected int64
	}{
		{"world", world, 100000},
		{"dense_jinhua", baiduPhotoMapBounds{CoordinateSpace: "bd09ll",
			West: 118, South: 28, East: 120, North: 30}, 78000},
		{"two_cities", baiduPhotoMapBounds{CoordinateSpace: "bd09ll",
			West: 118, South: 28, East: 123, North: 33}, 95000},
		{"empty", baiduPhotoMapBounds{CoordinateSpace: "bd09ll",
			West: -10, South: 0, East: -8, North: 1}, 0},
	}
	metrics := make([]placesBD09Sample, 0, 14)
	for _, w := range windows {
		for _, op := range []string{"cells", "native_viewport", "camera_gallery_range"} {
			metrics = append(metrics, placesBD09Measure(t, db, owner.ID,
				w.name, w.bounds, w.expected, op, false))
		}
	}
	// This is a genuine first-10k membership subquery within the 100k
	// Owner, not a separate 10k Owner. Preserve this distinction in JSON.
	for _, w := range windows[:2] {
		metrics = append(metrics, placesBD09Measure(t, db, owner.ID,
			w.name, w.bounds, 10000, "cells", true))
	}
	artifact := os.Getenv("XD_PLACES_BD09_OUTPUT")
	if artifact == "" || len(metrics) != 14 {
		t.Fatal("no output path or incomplete 100k benchmark")
	}
	out := struct {
		Head                       string             `json:"ci_git_head"`
		Fixture                    string             `json:"fixture"`
		OwnerAssets                int                `json:"owner_assets"`
		MediaRows                  int                `json:"media_rows"`
		SubsetMembers              int                `json:"subset_members"`
		SampleCount                int                `json:"sample_count"`
		ProviderConversionVerified bool               `json:"provider_conversion_verified"`
		Metrics                    []placesBD09Sample `json:"metrics"`
	}{
		Head:        os.Getenv("XD_PLACES_BD09_HEAD"),
		Fixture:     "isolated PostgreSQL17 / synthetic source-fenced BD09 coordinates / real production query methods",
		OwnerAssets: 100000, MediaRows: 115000, SubsetMembers: 10000,
		SampleCount: 3, ProviderConversionVerified: false, Metrics: metrics,
	}
	if len(out.Head) != 40 {
		t.Fatalf("no exact GitHub source HEAD: %q", out.Head)
	}
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(artifact), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifact, append(data, '\n'), 0644); err != nil {
		t.Fatal(err)
	}
	t.Logf("PLACES_BD09_FINISHED exactHead=%s measurements=%d output=%s",
		out.Head, len(metrics), artifact)
}
