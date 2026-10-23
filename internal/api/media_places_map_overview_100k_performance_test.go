package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Opt-in, metadata-only, real PostgreSQL fixture. Never runs in normal API CI.
// Both historical BEFORE and proposed AFTER test binaries compile THIS file,
// query their OWN production queryMediaPlacesMapOverview, and use the SAME
// indexed 100k PhotoAsset / 115k MediaMetadata rows in the same PostgreSQL 17.
const placesOverview100KSchema = "xdrive_places_overview_perf100k"

type placesOverview100KSample struct {
	Phase          string  `json:"phase"`
	Run            int     `json:"run"`
	Window         string  `json:"window"`
	ElapsedMS      float64 `json:"elapsed_ms"`
	ExpectedPhotos int64   `json:"expected_photos"`
	Photos         int64   `json:"photos"`
	Pins           int     `json:"pins"`
	VerifiedCovers int     `json:"verified_covers"`
	Error          string  `json:"error,omitempty"`
}

func placesOverview100KDatabase(t *testing.T, setup bool) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("100k PostgreSQL benchmark requires XD_TEST_DATABASE_URL")
	}
	if setup {
		// Schema deletion is permitted only by the explicit disposable CI
		// fixture gate, never on user/production databases or without opt-in.
		if os.Getenv("XD_PLACES_100K_DISPOSABLE_CI") != "1" {
			t.Fatal("refusing benchmark schema reset outside disposable CI")
		}
		admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Silent),
		})
		if err != nil {
			t.Fatal(err)
		}
		for _, statement := range []string{
			"DROP SCHEMA IF EXISTS " + placesOverview100KSchema + " CASCADE",
			"CREATE SCHEMA " + placesOverview100KSchema,
		} {
			if err := admin.Exec(statement).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := parsed.Query()
	q.Set("search_path", placesOverview100KSchema)
	parsed.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func placesOverview100KSeed(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.MediaMetadata{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{}, &meta.PhotoAsset{},
		&meta.PhotoEditRecipe{}, &meta.PhotoMetadata{}, &meta.PhotoResource{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "places-perf-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	folder := meta.Node{Name: "places-perf-100k", Type: meta.NodeTypeDir,
		OwnerID: owner.ID, ParentID: &root.ID, Revision: 1}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	// Existing production-shaped Gallery fixture: 70k images, 15k videos,
	// 15k Live Photo logical assets; 115k distinct primary/sidecar media nodes.
	// Media originals are NOT written to CAS: this measures SQL metadata only.
	mediaGallerySeedFirstOpen100K(t, db, owner.ID, folder.ID)
	// Every logical PhotoAsset gets valid WGS84 GPS. 78k dense Jinhua, 17k
	// Shanghai and 5k New York. Every 17th item shares the previous GPS,
	// exercising count(DISTINCT) and the ranked coordinate partition.
	// Motion-only Live resources do not gain fabricated GPS.
	result := db.Exec("WITH numbered AS ("+
		" SELECT primary_node_id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS ordinal"+
		" FROM xd_photo_assets WHERE owner_id = ?"+
		"), positions AS ("+
		" SELECT primary_node_id, CASE WHEN ordinal > 0 AND ordinal % 17 = 0"+
		" THEN ordinal - 1 ELSE ordinal END AS pos FROM numbered"+
		"), points AS ("+
		" SELECT primary_node_id,"+
		" CASE WHEN pos < 78000 THEN 29.0 + ((pos % 1000)::float8 * 0.0001)"+
		" WHEN pos < 95000 THEN 31.1 + (((pos-78000) % 500)::float8 * 0.00012)"+
		" ELSE 40.6 + (((pos-95000) % 500)::float8 * 0.00012) END AS lat,"+
		" CASE WHEN pos < 78000 THEN 119.0 + ((pos / 1000)::float8 * 0.0001)"+
		" WHEN pos < 95000 THEN 121.2 + (((pos-78000) / 500)::float8 * 0.0001)"+
		" ELSE -74.0 + (((pos-95000) / 500)::float8 * 0.0001) END AS lon"+
		" FROM positions"+
		") UPDATE xd_media_metadata AS mm SET latitude = points.lat,"+
		" longitude = points.lon FROM points WHERE mm.node_id = points.primary_node_id",
		owner.ID)
	if result.Error != nil || result.RowsAffected != 100_000 {
		t.Fatalf("GPS setup must update exactly 100k primary media rows: rows=%d error=%v",
			result.RowsAffected, result.Error)
	}
	// A valid foreign account in the same tables must never appear in the
	// measured Owner map or count.
	foreign := meta.User{Username: "places-perf-foreign", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	foreignNode := meta.Node{Name: "foreign.jpg", Type: meta.NodeTypeFile,
		OwnerID: foreign.ID, Revision: 1}
	if err := db.Create(&foreignNode).Error; err != nil {
		t.Fatal(err)
	}
	lat, lon := 29.01, 119.01
	if err := db.Create(&meta.MediaMetadata{NodeID: foreignNode.ID,
		OwnerID: foreign.ID, NodeRevision: 1, MediaKind: meta.MediaKindImage,
		MIMEType: "image/jpeg", Latitude: &lat, Longitude: &lon,
		IndexState: meta.MediaIndexStateReady}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoAsset{OwnerID: foreign.ID,
		PrimaryNodeID: foreignNode.ID, Kind: meta.PhotoAssetKindImage,
		EvidenceKey: fmt.Sprintf("node:%d", foreignNode.ID)}).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"xd_nodes", "xd_photo_assets", "xd_media_metadata"} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	var count int64
	if err := mediaPlacesBaseQuery(context.Background(), db, owner.ID).
		Distinct("pa.id").Count(&count).Error; err != nil || count != 100_000 {
		t.Fatalf("GPS Owner logical assets=%d want=100000 err=%v", count, err)
	}
	var physical int64
	if err := db.Model(&meta.MediaMetadata{}).Where("owner_id = ?",
		owner.ID).Count(&physical).Error; err != nil || physical != 115_000 {
		t.Fatalf("media rows=%d want=115000 err=%v", physical, err)
	}
	t.Logf("MAP_PLACES100K_SEED owner_assets=%d media_nodes=%d foreign_assets=1 seed_ms=%.3f schema=%s",
		count, physical, float64(time.Since(started).Microseconds())/1000,
		placesOverview100KSchema)
}

func placesOverview100KProbe(t *testing.T, db *gorm.DB, ownerID uint64,
	phase string, run int, name string, bounds mediaPlaceViewportBounds, expected int64) {
	t.Helper()
	// An equal warmup per invocation excludes process startup and connection
	// initialization; BEFORE/AFTER order is alternated in the workflow.
	warm, stopWarm := context.WithTimeout(context.Background(), mediaPlaceViewportQueryTimeout)
	_, _ = queryMediaPlacesMapOverview(warm, db, ownerID, bounds, false)
	stopWarm()

	ctx, stop := context.WithTimeout(context.Background(), mediaPlaceViewportQueryTimeout)
	started := time.Now()
	page, err := queryMediaPlacesMapOverview(ctx, db, ownerID, bounds, false)
	ms := float64(time.Since(started).Microseconds()) / 1000
	stop()
	report := placesOverview100KSample{
		Phase: phase, Run: run, Window: name, ElapsedMS: ms,
		ExpectedPhotos: expected,
	}
	if err != nil {
		report.Error = err.Error()
	} else {
		report.Photos, report.Pins = page.TotalPhotoCount, len(page.Items)
		if !page.Aggregated || page.TotalPhotoCount != expected ||
			report.Pins > mediaMapOverviewMaxPoints ||
			(expected > 0 && report.Pins == 0) {
			report.Error = fmt.Sprintf("invalid server result photos=%d pins=%d aggregated=%t",
				report.Photos, report.Pins, page.Aggregated)
		}
		if phase == "after" && report.Error == "" {
			for _, item := range page.Items {
				if item.CoverNodeID == nil {
					continue
				}
				var media meta.MediaMetadata
				if e := db.Where("node_id = ? AND owner_id = ?",
					*item.CoverNodeID, ownerID).First(&media).Error; e != nil ||
					media.Latitude == nil || media.Longitude == nil ||
					*media.Latitude != item.SampleLatitude ||
					*media.Longitude != item.SampleLongitude {
					report.Error = fmt.Sprintf("cover mismatch at map pin %s: %v", item.ID, e)
					break
				}
				report.VerifiedCovers++
			}
		}
	}
	data, e := json.Marshal(report)
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("MAP_PLACES100K_SAMPLE %s", string(data))
}

func TestPlacesOverviewPostgres100kMatchedBeforeAfter(t *testing.T) {
	if os.Getenv("XD_PLACES_100K_PERF") != "1" {
		t.Skip("dedicated disposable 100k map SQL benchmark only")
	}
	action := os.Getenv("XD_PLACES_100K_ACTION")
	if action != "seed" && action != "probe" {
		t.Fatalf("invalid benchmark action %q", action)
	}
	db := placesOverview100KDatabase(t, action == "seed")
	if action == "seed" {
		placesOverview100KSeed(t, db)
		return
	}
	phase := os.Getenv("XD_PLACES_100K_PHASE")
	if phase != "before" && phase != "after" {
		t.Fatalf("invalid benchmark phase %q", phase)
	}
	run, err := strconv.Atoi(os.Getenv("XD_PLACES_100K_RUN"))
	if err != nil || run < 1 || run > 3 {
		t.Fatalf("invalid run ordinal: %v", err)
	}
	var owner meta.User
	if err := db.Where("username = ?", "places-perf-owner").First(&owner).Error; err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct {
		name     string
		bounds   mediaPlaceViewportBounds
		expected int64
	}{
		{"world", mediaPlaceViewportBounds{West: -180, South: -85, East: 180, North: 85}, 100_000},
		{"dense-city", mediaPlaceViewportBounds{West: 118, South: 28, East: 120, North: 30}, 78_000},
		{"two-cities", mediaPlaceViewportBounds{West: 118, South: 28, East: 123, North: 33}, 95_000},
		{"empty", mediaPlaceViewportBounds{West: -10, South: 0, East: -8, North: 1}, 0},
	} {
		placesOverview100KProbe(t, db, owner.ID, phase, run,
			scenario.name, scenario.bounds, scenario.expected)
	}
}
