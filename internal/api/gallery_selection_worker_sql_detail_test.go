package api

import (
	"context"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// gallerySelectionDetailedProfiler adds test-only per-query-stage latency
// attribution to the existing GORM SQL profiler. It does not change the
// production DB, Worker SQL, 100-item checkpoints, or cancellation contract.
// Recorded time includes client/driver/observer overhead and is not EXPLAIN.
type gallerySelectionDetailedProfiler struct {
	*gallerySelectionSQLProfiler
	mu            sync.Mutex
	selectSamples map[string][]float64
}

type galleryWorkerSQLDetail struct {
	Statements int     `json:"statements"`
	TotalMS    float64 `json:"total_ms"`
	P50MS      float64 `json:"p50_ms"`
	P95MS      float64 `json:"p95_ms"`
	MaxMS      float64 `json:"max_ms"`
}

func newGallerySelectionDetailedProfiler() *gallerySelectionDetailedProfiler {
	return &gallerySelectionDetailedProfiler{
		gallerySelectionSQLProfiler: newGallerySelectionSQLProfiler(),
		selectSamples:               make(map[string][]float64),
	}
}

func galleryWorkerSelectStage(sql string) string {
	fields := strings.Fields(strings.ToLower(sql))
	if len(fields) < 2 || fields[0] != "select" {
		return ""
	}
	normalized := strings.Join(fields, " ")
	tables := [...]struct {
		stage string
		table string
	}{
		{"jobs", "xd_media_selection_jobs"},
		{"items", "xd_media_selection_job_items"},
		{"nodes", "xd_nodes"},
		{"assets", "xd_photo_assets"},
		{"metadata", "xd_photo_metadata"},
	}
	for _, t := range tables {
		if strings.Contains(normalized, `from "`+t.table+`"`) {
			return t.stage
		}
	}
	return "unclassified"
}

func (p *gallerySelectionDetailedProfiler) Trace(ctx context.Context, begin time.Time, fc func() (string, int64), err error) {
	elapsedMS := float64(time.Since(begin).Microseconds()) / 1000
	sql, rows := fc()
	p.gallerySelectionSQLProfiler.Trace(ctx, begin, func() (string, int64) { return sql, rows }, err)
	stage := galleryWorkerSelectStage(sql)
	if stage == "" {
		return
	}
	p.gallerySelectionSQLProfiler.mu.Lock()
	phase := p.gallerySelectionSQLProfiler.phase
	p.gallerySelectionSQLProfiler.mu.Unlock()
	if phase != "worker" {
		return
	}
	p.mu.Lock()
	p.selectSamples[stage] = append(p.selectSamples[stage], elapsedMS)
	p.mu.Unlock()
}

// selectDetailSnapshot returns one aggregate per named SQL SELECT category.
// The median interpolates the two central observations for even populations;
// P95 uses the nearest-rank definition and is explicitly diagnostic.
func (p *gallerySelectionDetailedProfiler) selectDetailSnapshot() map[string]galleryWorkerSQLDetail {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make(map[string]galleryWorkerSQLDetail, len(p.selectSamples))
	for stage, original := range p.selectSamples {
		samples := append([]float64(nil), original...)
		sort.Float64s(samples)
		n := len(samples)
		if n == 0 {
			continue
		}
		total := 0.0
		for _, ms := range samples {
			total += ms
		}
		out[stage] = galleryWorkerSQLDetail{
			Statements: n,
			TotalMS:    total,
			P50MS:      (samples[(n-1)/2] + samples[n/2]) / 2,
			P95MS:      samples[(95*n+99)/100-1],
			MaxMS:      samples[n-1],
		}
	}
	return out
}

func TestGalleryWorkerSelectStage(t *testing.T) {
	for _, tc := range []struct {
		sql  string
		want string
	}{
		{`SELECT * FROM "xd_media_selection_jobs" WHERE id=1`, "jobs"},
		{`SELECT * FROM "xd_media_selection_job_items" WHERE job_id=1`, "items"},
		{`SELECT * FROM "xd_nodes" WHERE id IN (1,2)`, "nodes"},
		{`SELECT * FROM "xd_photo_assets" WHERE owner_id=1`, "assets"},
		{`SELECT * FROM "xd_photo_metadata" WHERE asset_id=1`, "metadata"},
		{`SELECT
  * FROM "xd_photo_metadata" WHERE asset_id=1`, "metadata"},
		{`UPDATE "xd_photo_metadata" SET favorite=true`, ""},
		{`SELECT 1`, "unclassified"},
	} {
		if got := galleryWorkerSelectStage(tc.sql); got != tc.want {
			t.Fatalf("SQL %q: got stage %q, want %q", tc.sql, got, tc.want)
		}
	}
}
