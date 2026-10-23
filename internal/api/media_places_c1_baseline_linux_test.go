package api

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// This test is intentionally opt-in: creating real PostgreSQL 100k-row
// media indexes must never slow unrelated Go unit / race CI jobs.
// It does NOT create physical JPEG/HEIC/MP4/CAS bytes or assert device parity.
const c1PlacesForeignAssets = 37

// Capture every production read in an Owner Range, not just its longest
// query: Count, timeline groups, page materialization and secondary lookups
// may each contribute to an otherwise unexplained 100k end-to-end latency.
type c1PlacesStatement struct {
	SQL       string
	ElapsedMS float64
	Rows      int64
}

type c1PlacesTrace struct {
	mu         sync.Mutex
	statements []c1PlacesStatement
}

func (l *c1PlacesTrace) LogMode(logger.LogLevel) logger.Interface      { return l }
func (l *c1PlacesTrace) Info(context.Context, string, ...interface{})  {}
func (l *c1PlacesTrace) Warn(context.Context, string, ...interface{})  {}
func (l *c1PlacesTrace) Error(context.Context, string, ...interface{}) {}
func (l *c1PlacesTrace) Trace(_ context.Context, started time.Time, sqlFunc func() (string, int64), err error) {
	if err != nil {
		return
	}
	sql, rows := sqlFunc()
	upper := strings.ToUpper(strings.TrimSpace(sql))
	if !strings.HasPrefix(upper, "SELECT ") && !strings.HasPrefix(upper, "WITH ") {
		return
	}
	elapsed := c1PlacesMilliseconds(time.Since(started))
	l.mu.Lock()
	l.statements = append(l.statements, c1PlacesStatement{
		SQL: sql, ElapsedMS: elapsed, Rows: rows,
	})
	l.mu.Unlock()
}
func (l *c1PlacesTrace) reset() {
	l.mu.Lock()
	l.statements = nil
	l.mu.Unlock()
}
func (l *c1PlacesTrace) snapshot() []c1PlacesStatement {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]c1PlacesStatement(nil), l.statements...)
}

func c1PlacesStatementRole(sql string) string {
	upper := strings.ToUpper(strings.TrimSpace(sql))
	switch {
	case strings.Contains(upper, "COUNT(DISTINCT"):
		return "distinct_count"
	case strings.Contains(upper, "GROUP BY"):
		return "grouped_read"
	case strings.HasPrefix(upper, "WITH "):
		return "cte"
	case strings.Contains(upper, "LIMIT "):
		return "bounded_page"
	default:
		return "read"
	}
}

type c1PlacesStatementPlan struct {
	Order     int             `json:"order"`
	Role      string          `json:"role"`
	SQLSHA256 string          `json:"sql_sha256"`
	FirstMS   float64         `json:"first_ms"`
	Rows      int64           `json:"rows"`
	Plan      json.RawMessage `json:"explain_analyze_buffers"`
}

type c1PlacesMetric struct {
	Operation      string                  `json:"operation"`
	SampleCount    int                     `json:"sample_count"`
	FirstMS        float64                 `json:"first_ms"`
	P50MS          float64                 `json:"p50_ms"`
	P95MS          float64                 `json:"p95_ms"`
	MaxMS          float64                 `json:"max_ms"`
	Count          int64                   `json:"count"`
	Plan           json.RawMessage         `json:"explain_analyze_buffers,omitempty"`
	FirstSQLMS     float64                 `json:"first_sql_ms"`
	StatementPlans []c1PlacesStatementPlan `json:"statement_plans"`
}
type c1PlacesReport struct {
	Head                string           `json:"ci_git_head"`
	Postgres            string           `json:"postgres_version"`
	Assets              int              `json:"owner_assets"`
	ForeignAssets       int              `json:"foreign_assets"`
	SeedMS              float64          `json:"seed_ms"`
	TestProcessMaxRSSKB int64            `json:"test_process_max_rss_kb"`
	Metrics             []c1PlacesMetric `json:"metrics"`
	Notes               []string         `json:"notes"`
}

func c1PlacesMilliseconds(duration time.Duration) float64 {
	return math.Round(float64(duration.Microseconds())/1000*1000) / 1000
}
func c1PlacesPctl(sorted []time.Duration, pct float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	index := int(math.Ceil(pct*float64(len(sorted)))) - 1
	if index < 0 {
		index = 0
	}
	return c1PlacesMilliseconds(sorted[index])
}

func c1PlacesMeasure(t *testing.T, db *gorm.DB, trace *c1PlacesTrace,
	name string, query func(context.Context) (int64, error)) c1PlacesMetric {
	t.Helper()
	trace.reset()
	firstCtx, firstCancel := context.WithTimeout(context.Background(), 90*time.Second)
	start := time.Now()
	count, err := query(firstCtx)
	firstDuration := time.Since(start)
	firstCancel()
	if err != nil {
		t.Fatalf("%s first real SQL failed: %v", name, err)
	}
	// All SQL below was executed by the actual Owner query's first call.
	// Capture first-call timings before running EXPLAIN or warm repetitions.
	// Bounded read statements only: no SQL writes or test fixture mutations.
	recorded := trace.snapshot()
	if len(recorded) < 1 || len(recorded) > 32 {
		t.Fatalf("%s unexpected number of production read statements: %d", name, len(recorded))
	}
	var explain []byte
	statementPlans := make([]c1PlacesStatementPlan, 0, len(recorded))
	var firstSQLMS float64
	var selectedLength int
	for index, statement := range recorded {
		if len(statement.SQL) > 128*1024 {
			t.Fatalf("%s SQL statement %d is unexpectedly large", name, index+1)
		}
		var plan []byte
		if err := db.Raw("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + statement.SQL).
			Row().Scan(&plan); err != nil {
			t.Fatalf("%s production SQL %d EXPLAIN failed: %v", name, index+1, err)
		}
		if !json.Valid(plan) {
			t.Fatalf("%s returned invalid EXPLAIN JSON for statement %d", name, index+1)
		}
		firstSQLMS += statement.ElapsedMS
		statementPlans = append(statementPlans, c1PlacesStatementPlan{
			Order:     index + 1,
			Role:      c1PlacesStatementRole(statement.SQL),
			SQLSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte(statement.SQL))),
			FirstMS:   statement.ElapsedMS,
			Rows:      statement.Rows,
			Plan:      json.RawMessage(plan),
		})
		if len(statement.SQL) > selectedLength &&
			strings.Contains(statement.SQL, "xd_photo_assets") {
			explain = plan // Retain the original longest-query plan for parity.
			selectedLength = len(statement.SQL)
		}
	}
	if len(explain) == 0 {
		t.Fatalf("%s lacks the original PhotoAsset production SQL", name)
	}
	samples := make([]time.Duration, 0, 7)
	for i := 0; i < 7; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		began := time.Now()
		got, runErr := query(ctx)
		elapsed := time.Since(began)
		cancel()
		if runErr != nil {
			t.Fatalf("%s repeat %d failed: %v", name, i, runErr)
		}
		if got != count {
			t.Fatalf("%s inconsistent real count: first=%d repeat=%d", name, count, got)
		}
		samples = append(samples, elapsed)
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	metric := c1PlacesMetric{
		Operation: name, SampleCount: len(samples), Count: count,
		FirstMS:        c1PlacesMilliseconds(firstDuration),
		P50MS:          c1PlacesPctl(samples, .50),
		P95MS:          c1PlacesPctl(samples, .95),
		MaxMS:          c1PlacesMilliseconds(samples[len(samples)-1]),
		Plan:           json.RawMessage(explain),
		FirstSQLMS:     firstSQLMS,
		StatementPlans: statementPlans,
	}
	t.Logf("C1_PLACES_PG %s repeats=%d first_ms=%.3f p50_ms=%.3f p95_ms=%.3f count=%d sql_statements=%d first_sql_ms=%.3f",
		metric.Operation, metric.SampleCount, metric.FirstMS, metric.P50MS, metric.P95MS,
		count, len(metric.StatementPlans), metric.FirstSQLMS)
	return metric
}

func c1PlacesFixture(t *testing.T, dsn string, total int) (*gorm.DB, uint64, uint64, time.Duration) {
	t.Helper()
	started := time.Now()
	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "c1_places_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := admin.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := admin.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error; err != nil {
			t.Errorf("failed to remove isolated C1 PostgreSQL schema: %v", err)
		}
	})
	u, err := c1PlacesDSNWithSearchPath(dsn, schema)
	if err != nil {
		t.Fatal(err)
	}
	db, err := gorm.Open(postgres.Open(u), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.MediaMetadata{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{}, &meta.MediaDerivedResource{},
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoResource{},
		&meta.PhotoMetadata{}, &meta.PhotoAnalysisState{}, &meta.PhotoPlaceLabel{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}
	a := meta.User{Username: "c1-owner-a", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	b := meta.User{Username: "c1-owner-b", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&a).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&b).Error; err != nil {
		t.Fatal(err)
	}
	aRoot := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: a.ID, Revision: 1}
	bRoot := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: b.ID, Revision: 1}
	if err := db.Create(&aRoot).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&bRoot).Error; err != nil {
		t.Fatal(err)
	}

	// One set-based generation avoids 100k ORM INSERT round trips. Records
	// live in a unique disposable PostgreSQL schema; never point at customer
	// data. Geography is deterministic, mixed-media and Owner-separated.
	seed := `CREATE TABLE c1_seed AS
    WITH base AS (
      SELECT g::bigint AS seq,
        CASE WHEN g <= ? THEN ?::bigint ELSE ?::bigint END AS owner_id,
        CASE WHEN g <= ? THEN ?::bigint ELSE ?::bigint END AS parent_id,
        CASE WHEN g % 10 < 7 THEN 'JP' WHEN g % 10 < 9 THEN 'US' ELSE 'GB' END AS country_code,
        CASE WHEN g % 10 < 7 THEN CASE WHEN g % 2 = 0 THEN '13' ELSE '27' END
          WHEN g % 10 < 9 THEN 'CA' ELSE 'ENG' END AS region_code
      FROM generate_series(1, ?::integer + 37) AS g
    ), coords AS (
      SELECT *, (CASE WHEN country_code='JP' AND region_code='13' THEN 35.60
                      WHEN country_code='JP' THEN 34.70
                      WHEN country_code='US' THEN 37.70 ELSE 51.50 END +
                 (seq % 1000)::double precision * 0.00006)::double precision AS latitude,
                (CASE WHEN country_code='JP' AND region_code='13' THEN 139.60
                      WHEN country_code='JP' THEN 135.50
                      WHEN country_code='US' THEN -122.40 ELSE -0.10 END +
                 (seq / 1000)::double precision * 0.000007)::double precision AS longitude
      FROM base
    )
    SELECT seq, owner_id, parent_id,
      (1000000 + seq)::bigint AS node_id,
      (2000000 + seq)::bigint AS asset_id,
      latitude, longitude,
      country_code, region_code,
      (1850000 + seq % 997)::bigint AS city_id,
      ('City ' || (seq % 997)::text) AS city_name,
      CASE WHEN seq % 15 = 0 THEN 'video' ELSE 'image' END AS media_kind,
      CASE WHEN seq % 15 = 0 THEN 'video/mp4'
           WHEN seq % 37 = 0 THEN 'image/heic' ELSE 'image/jpeg' END AS mime_type,
      (seq % 7 = 0) AS favorite,
      (TIMESTAMPTZ '2025-01-01 00:00:00+00' +
       (seq % 700) * INTERVAL '1 day') AS captured_at
    FROM coords`
	if err := db.Exec(seed, total, a.ID, b.ID, total, aRoot.ID, bRoot.ID, total).Error; err != nil {
		t.Fatal(err)
	}
	// PostgreSQL GORM float64 columns are NUMERIC/DECIMAL by default.
	// Build legacy provenance fingerprints after the PhotoMetadata INSERT,
	// from persisted GPS. The synthetic FLOAT8 seed may round differently.
	statements := []string{
		`INSERT INTO xd_nodes (id,parent_id,name,type,owner_id,revision,created_at,updated_at)
          SELECT node_id,parent_id,'c1-'||seq||'.jpg','file',owner_id,1,now(),now() FROM c1_seed`,
		`INSERT INTO xd_files (node_id,size,storage_key,sha256,created_at,updated_at)
          SELECT node_id,1024,'c1/'||seq,lpad(to_hex(seq),64,'0'),now(),now() FROM c1_seed`,
		`INSERT INTO xd_media_metadata (node_id,owner_id,node_revision,sha256,media_kind,mime_type,
           captured_at,latitude,longitude,index_state,created_at,updated_at)
          SELECT node_id,owner_id,1,lpad(to_hex(seq),64,'0'),media_kind,mime_type,
            captured_at,latitude,longitude,'ready',now(),now() FROM c1_seed`,
		`INSERT INTO xd_photo_assets (id,owner_id,primary_node_id,kind,evidence_key,created_at,updated_at)
          SELECT asset_id,owner_id,node_id,
            CASE WHEN seq % 101 = 0 THEN 'live_photo' ELSE media_kind END,
            'node:'||node_id,now(),now() FROM c1_seed`,
		`INSERT INTO xd_photo_metadata (asset_id,media_kind,mime_type,captured_at,latitude,longitude,
           favorite,created_at,updated_at)
          SELECT asset_id,media_kind,mime_type,captured_at,latitude,longitude,
            favorite,now(),now() FROM c1_seed`,
		`INSERT INTO xd_photo_resources (asset_id,resource_kind,node_id,role,name,media_kind,mime_type,
           size,created_at,updated_at)
          SELECT asset_id,'node',node_id,'primary','c1-'||seq||'.jpg',media_kind,mime_type,
            1024,now(),now() FROM c1_seed`,
		`INSERT INTO xd_photo_analysis_states (asset_id,kind,analyzer_version,input_fingerprint,
           state,completed_at,created_at,updated_at)
          SELECT seed.asset_id,'place_label','geonames-cities500@c1-v1',
            'gps:' || encode(float8send(pm.latitude),'hex') || ':' ||
              encode(float8send(pm.longitude),'hex'),
            'ready',now(),now(),now()
          FROM c1_seed AS seed
          JOIN xd_photo_metadata AS pm ON pm.asset_id=seed.asset_id`,
		`INSERT INTO xd_photo_place_labels (asset_id,resolver,resolver_version,input_fingerprint,
           latitude,longitude,country_code,country,region_code,region,city_geo_name_id,city,
           formatted,distance_km,created_at,updated_at)
          SELECT seed.asset_id,'geonames-cities500','c1-v1',
            'gps:' || encode(float8send(pm.latitude),'hex') || ':' ||
              encode(float8send(pm.longitude),'hex'),
            pm.latitude,pm.longitude,
            seed.country_code,CASE seed.country_code WHEN 'JP' THEN 'Japan' WHEN 'US' THEN 'United States' ELSE 'United Kingdom' END,
            seed.region_code,CASE seed.region_code WHEN '13' THEN 'Tokyo' WHEN '27' THEN 'Osaka'
              WHEN 'CA' THEN 'California' ELSE 'England' END,
            seed.city_id,seed.city_name,seed.city_name,1.25,now(),now()
          FROM c1_seed AS seed
          JOIN xd_photo_metadata AS pm ON pm.asset_id=seed.asset_id`,
	}
	for index, sql := range statements {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatalf("bulk fixture insert %d: %v", index, err)
		}
	}
	// Fail the fixture if any persisted provenance differs from the GPS
	// bytes that the real Owner Facet/Range trust predicate will read.
	var mismatchedProvenance int64
	if err := db.Raw(`SELECT COUNT(*)
      FROM xd_photo_place_labels AS ppl
      JOIN xd_photo_metadata AS pm ON pm.asset_id=ppl.asset_id
      JOIN xd_photo_analysis_states AS pas ON pas.asset_id=ppl.asset_id
      WHERE ppl.input_fingerprint IS DISTINCT FROM
        ('gps:' || encode(float8send(pm.latitude),'hex') || ':' ||
         encode(float8send(pm.longitude),'hex'))
        OR pas.input_fingerprint IS DISTINCT FROM ppl.input_fingerprint`).
		Scan(&mismatchedProvenance).Error; err != nil {
		t.Fatal(err)
	}
	if mismatchedProvenance != 0 {
		t.Fatalf("C1 fixture has %d stale GPS fingerprints after persistence", mismatchedProvenance)
	}
	if err := db.Exec("ANALYZE").Error; err != nil {
		t.Fatal(err)
	}
	var owned, foreign int64
	if err := db.Table("xd_photo_assets").Where("owner_id = ?", a.ID).Count(&owned).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Table("xd_photo_assets").Where("owner_id = ?", b.ID).Count(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	if owned != int64(total) || foreign != c1PlacesForeignAssets {
		t.Fatalf("fixture Owner counts=%d/%d", owned, foreign)
	}
	return db, a.ID, b.ID, time.Since(started)
}

// Preserve DSN user/host/database and inject a disposable namespace, using the
// same connection-scoped PostgreSQL search_path strategy as the B1 integration.
func c1PlacesDSNWithSearchPath(dsn, schema string) (string, error) {
	u, err := url.Parse(dsn)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	return u.String(), nil
}
func c1PlacesSaveReport(t *testing.T, reports []c1PlacesReport) {
	t.Helper()
	path := os.Getenv("XD_C1_PLACES_OUTPUT")
	if path == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	raw, err := json.MarshalIndent(reports, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(raw, '\n'), 0644); err != nil {
		t.Fatal(err)
	}
}

// TestC1PlacesPostgresBaseline executes real xDrive read queries against
// actual 10k/100k PostgreSQL media/PhotoAsset/GeoNames metadata rows, with
// 37 independent foreign-Owner rows. It is a BEFORE-only evidence generator.
func TestC1PlacesPostgresBaseline(t *testing.T) {
	if os.Getenv("XD_C1_PLACES_BASELINE") != "1" {
		t.Skip("opt-in PostgreSQL C1 baseline")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("XD_TEST_DATABASE_URL required for real PostgreSQL baseline")
	}
	reports := make([]c1PlacesReport, 0, 2)
	for _, size := range []int{10000, 100000} {
		t.Run(fmt.Sprintf("owner_%d", size), func(t *testing.T) {
			db, owner, foreign, seedDuration := c1PlacesFixture(t, dsn, size)
			capture := &c1PlacesTrace{}
			server := &Server{DB: db.Session(&gorm.Session{Logger: capture}),
				PhotoPlaceResolver: mediaPlaceHierarchyFakeResolver{version: "c1-v1"}}
			var version string
			if err := db.Raw("SELECT current_setting('server_version')").Scan(&version).Error; err != nil {
				t.Fatal(err)
			}
			// GitHub pull_request's GITHUB_SHA can be a synthetic merge commit.
			// The focused workflow provides the exact checked-out PR HEAD.
			sourceHead := os.Getenv("XD_C1_PLACES_SOURCE_HEAD")
			if sourceHead == "" {
				sourceHead = os.Getenv("GITHUB_SHA")
			}
			report := c1PlacesReport{Head: sourceHead, Postgres: version,
				Assets: size, ForeignAssets: c1PlacesForeignAssets,
				SeedMS: c1PlacesMilliseconds(seedDuration),
				Notes: []string{
					"Synthetic indexed PostgreSQL rows, not physical CAS/media bytes or a device benchmark",
					"Client process MaxRSSKB is NOT PostgreSQL server RSS or CPU",
					"Single-run cold-ish first request and 7 warm samples; not paired BEFORE/AFTER",
					"EXPLAIN ANALYZE BUFFERS captured from production-generated SQL",
				}}
			country := mediaPlaceHierarchyKey{Level: "country"}
			region := mediaPlaceHierarchyKey{Level: "region", Country: "JP"}
			city := mediaPlaceHierarchyKey{Level: "city", Country: "JP", Region: "13"}
			for _, facet := range []struct {
				name  string
				key   mediaPlaceHierarchyKey
				limit int
			}{
				{"country_facets", country, 48}, {"region_JP_facets", region, 48},
				{"city_JP_13_first_48", city, 48},
			} {
				report.Metrics = append(report.Metrics, c1PlacesMeasure(t, db, capture, facet.name,
					func(ctx context.Context) (int64, error) {
						page, err := server.queryMediaPlaceHierarchy(ctx, owner, mediaQueryOptions{}, "", facet.key, "", "", facet.limit)
						if err != nil {
							return 0, err
						}
						if !page.Available || len(page.Items) > 48 || (facet.name == "city_JP_13_first_48" && !page.HasMore) {
							return 0, fmt.Errorf("unbounded/unavailable hierarchy page: %+v", page)
						}
						var count int64
						for _, item := range page.Items {
							count += item.PhotoCount
						}
						if facet.name == "country_facets" && count != int64(size) {
							// Fail the benchmark with stage-by-stage evidence. Never silently
							// relax B1 GPS/fingerprint provenance to make an artificial
							// 100k throughput benchmark pass.
							var diagnostic struct {
								Joined, Live, Indexed, Resolver, LabelFingerprint, StateFingerprint,
								StateVersion, GPSMatch, CountryCode, Trusted int64
							}
							diagSQL := `SELECT COUNT(*) AS joined,
  COUNT(*) FILTER (WHERE n.deleted_at IS NULL) AS live,
  COUNT(*) FILTER (WHERE mm.media_kind IN ('image','video') AND mm.index_state='ready') AS indexed,
  COUNT(*) FILTER (WHERE ppl.resolver='geonames-cities500' AND ppl.resolver_version='c1-v1') AS resolver,
  COUNT(*) FILTER (WHERE ppl.input_fingerprint = 'gps:' || encode(float8send(pm.latitude),'hex') || ':' || encode(float8send(pm.longitude),'hex')) AS label_fingerprint,
  COUNT(*) FILTER (WHERE ppl.input_fingerprint=pas.input_fingerprint) AS state_fingerprint,
  COUNT(*) FILTER (WHERE pas.kind='place_label' AND pas.state='ready' AND pas.analyzer_version='geonames-cities500@c1-v1') AS state_version,
  COUNT(*) FILTER (WHERE ppl.latitude=pm.latitude AND ppl.longitude=pm.longitude
    AND ppl.latitude=mm.latitude AND ppl.longitude=mm.longitude) AS gps_match,
  COUNT(*) FILTER (WHERE ppl.country_code ~ '^[A-Z]{2}$') AS country_code,
  COUNT(*) FILTER (WHERE n.deleted_at IS NULL AND mm.media_kind IN ('image','video') AND mm.index_state='ready'
    AND ppl.resolver='geonames-cities500' AND ppl.resolver_version='c1-v1'
    AND ppl.input_fingerprint=pas.input_fingerprint
    AND ppl.input_fingerprint = 'gps:' || encode(float8send(pm.latitude),'hex') || ':' || encode(float8send(pm.longitude),'hex')
    AND pas.kind='place_label' AND pas.state='ready' AND pas.analyzer_version='geonames-cities500@c1-v1'
    AND ppl.latitude=pm.latitude AND ppl.longitude=pm.longitude
    AND ppl.latitude=mm.latitude AND ppl.longitude=mm.longitude
    AND ppl.distance_km IS NOT NULL AND ppl.distance_km >= 0
    AND mm.latitude BETWEEN -90 AND 90 AND mm.longitude BETWEEN -180 AND 180
    AND ppl.country_code ~ '^[A-Z]{2}$') AS trusted
FROM xd_photo_assets pa
JOIN xd_media_metadata mm ON mm.node_id=pa.primary_node_id AND mm.owner_id=pa.owner_id
JOIN xd_nodes n ON n.id=pa.primary_node_id
JOIN xd_photo_metadata pm ON pm.asset_id=pa.id
JOIN xd_photo_place_labels ppl ON ppl.asset_id=pa.id
JOIN xd_photo_analysis_states pas ON pas.asset_id=pa.id
WHERE pa.owner_id=?`
							if err := db.Raw(diagSQL, owner).Scan(&diagnostic).Error; err != nil {
								return 0, fmt.Errorf("country sum %d: diagnostic failed: %w", count, err)
							}
							t.Logf("C1_COUNTRY_DIAGNOSTIC owner=%d size=%d facets=%+v rows=%+v", owner, size, page.Items, diagnostic)
							return 0, fmt.Errorf("country sum %d != %d; diagnostic=%+v", count, size, diagnostic)
						}
						if facet.name == "region_JP_facets" && count != int64(size*7/10) {
							return 0, fmt.Errorf("JP region sum=%d", count)
						}
						return count, nil
					}))
			}
			keys := []string{"country:JP", "region:JP:13", "city:JP:13:1850000"}
			for _, keyText := range keys {
				key, ok := parseMediaPlaceHierarchyKey(keyText)
				if !ok {
					t.Fatal("invalid benchmark key", keyText)
				}
				report.Metrics = append(report.Metrics, c1PlacesMeasure(t, db, capture, "range_"+keyText,
					func(ctx context.Context) (int64, error) {
						page, err := server.queryMediaItemRange(ctx, owner, mediaQueryOptions{PlaceHierarchy: &key}, "", 48, 0)
						if err != nil {
							return 0, err
						}
						if page.TotalCount < 1 || len(page.Items) > 48 {
							return 0, fmt.Errorf("invalid sparse range=%+v", page)
						}
						return page.TotalCount, nil
					}))
			}
			world := mediaPlaceViewportBounds{West: -180, South: -85, East: 180, North: 85}
			report.Metrics = append(report.Metrics, c1PlacesMeasure(t, db, capture, "world_map_64",
				func(ctx context.Context) (int64, error) {
					overview, err := queryMediaPlacesMapOverview(ctx, server.DB, owner, world, false)
					if err != nil {
						return 0, err
					}
					if !overview.Aggregated || len(overview.Items) > 64 || overview.TotalPhotoCount != int64(size) {
						return 0, fmt.Errorf("incorrect bounded map count/pins: %+v", overview)
					}
					return overview.TotalPhotoCount, nil
				}))
			other, err := queryMediaPlacesMapOverview(context.Background(), server.DB, foreign, world, false)
			if err != nil || other.TotalPhotoCount != c1PlacesForeignAssets {
				t.Fatalf("foreign Owner world total=%d expected %d: %v", other.TotalPhotoCount, c1PlacesForeignAssets, err)
			}
			// Source-level fail-closed cancellation is not a timed live browser
			// or Agent IPC metric; those remain separate C1 work.
			canceled, cancel := context.WithCancel(context.Background())
			cancel()
			if _, err := queryMediaPlacesMapOverview(canceled, server.DB, owner, world, false); err == nil {
				t.Fatal("pre-cancelled 100k map read succeeded")
			}
			var usage syscall.Rusage
			if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err == nil {
				report.TestProcessMaxRSSKB = usage.Maxrss
			}
			reports = append(reports, report)
			c1PlacesSaveReport(t, reports)
		})
	}
}
