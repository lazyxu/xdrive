package api

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"
)

func TestStoragePerformanceSummaryUsesFixedAnonymousRouteClasses(t *testing.T) {
	o := newServerObservability(nil)
	o.observeRequest("GET", "/api/v1/nodes/:id/children", 200, 10*time.Millisecond)
	o.observeRequest("GET", "/api/v1/nodes/:id/children", 503, 30*time.Millisecond)
	o.observeRequest("GET", "/api/v1/media/items/:id/thumbnail", 404, 5*time.Millisecond)
	o.observeRequest("PUT", "/api/v1/uploads/:id/chunks/:index", 200, 50*time.Millisecond)
	o.observeRequest("PUT", "/api/v1/uploads/:id/chunks/:index", 429, 5*time.Millisecond)
	o.observeRequest("GET", "/api/v1/nodes/123/private.jpg", 200, time.Hour)
	o.observeRequest("POST", "/api/v1/auth/login", 200, time.Hour)

	s := &Server{obs: o}
	got := s.snapshotStoragePerformance()
	if got == nil || len(got.Rows) != len(storagePerformanceKeys) {
		t.Fatalf("incorrect finite rows: %+v", got)
	}
	if got.StartedAt.IsZero() || got.CapturedAt.IsZero() {
		t.Fatal("missing collection and process lifetime times")
	}
	rows := make(map[string]storagePerformanceRowDTO, len(got.Rows))
	for _, row := range got.Rows {
		if _, exists := rows[row.Key]; exists {
			t.Fatalf("duplicated operation key %q", row.Key)
		}
		rows[row.Key] = row
	}
	files := rows["files_list"]
	if files.Requests != 2 || files.ServerErrors != 1 || math.Abs(files.AverageMS-20) > 0.000001 {
		t.Fatalf("file list duration/counter mismatch: %+v", files)
	}
	preview := rows["preview"]
	if preview.Requests != 1 || preview.ServerErrors != 0 || math.Abs(preview.AverageMS-5) > 0.000001 {
		t.Fatalf("expected preview 404 is not server error: %+v", preview)
	}
	upload := rows["upload_chunk"]
	if upload.Requests != 2 || upload.ServerErrors != 0 || math.Abs(upload.AverageMS-27.5) > 0.000001 {
		t.Fatalf("upload counter mismatch: %+v", upload)
	}
	if rows["download"].Requests != 0 || rows["gallery_list"].AverageMS != 0 {
		t.Fatal("unobserved operations must be zero, not fabricated metrics")
	}
	payload, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"private.jpg", "/api/v1/nodes/123", "auth/login"} {
		if strings.Contains(string(payload), secret) {
			t.Fatalf("real route/user data exposed in global storage metrics: %s", payload)
		}
	}
}

func TestStoragePerformanceNilObservability(t *testing.T) {
	if got := (&Server{}).snapshotStoragePerformance(); got != nil {
		t.Fatalf("unexpected data without running server: %+v", got)
	}
}

func BenchmarkStoragePerformanceReadOnlySnapshot(b *testing.B) {
	o := newServerObservability(nil)
	for i := 0; i < 100; i++ {
		o.observeRequest("GET", "/api/v1/nodes/:id/children", 200, time.Duration(i+1)*time.Millisecond)
		o.observeRequest("PUT", "/api/v1/uploads/:id/chunks/:index", 200, time.Duration(i+1)*time.Millisecond)
	}
	s := &Server{obs: o}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if s.snapshotStoragePerformance() == nil {
			b.Fatal("nil snapshot")
		}
	}
}

func TestStoragePerformance100kRequestsKeepFixedSizeSummary(t *testing.T) {
	o := newServerObservability(nil)
	for i := 0; i < 100000; i++ {
		o.observeRequest("GET", "/api/v1/nodes/:id/children", 200, time.Millisecond)
	}
	stats := (&Server{obs: o}).snapshotStoragePerformance()
	if stats == nil || len(stats.Rows) != len(storagePerformanceKeys) {
		t.Fatalf("unexpected summary size: %+v", stats)
	}
	files := stats.Rows[0]
	if files.Key != "files_list" || files.Requests != 100000 || files.ServerErrors != 0 || math.Abs(files.AverageMS-1) > 0.000001 {
		t.Fatalf("synthetic 100k request counters unexpected: %+v", files)
	}
	// 100k requests of one route/status must not create 100k labels or rows.
	if len(o.httpRequests) != 1 {
		t.Fatalf("unbounded metric cardinality: %d", len(o.httpRequests))
	}
}

func BenchmarkStoragePerformanceExistingHotPath(b *testing.B) {
	o := newServerObservability(nil)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		o.observeRequest("GET", "/api/v1/nodes/:id/children", 200, time.Millisecond)
	}
}
