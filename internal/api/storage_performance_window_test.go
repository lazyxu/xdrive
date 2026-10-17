package api

import (
	"math"
	"testing"
	"time"
)

func TestStoragePerformanceRecentWindowHasRealCoverageAndRates(t *testing.T) {
	o := newServerObservability(nil)
	s := &Server{obs: o}
	start := time.Date(2026, 10, 17, 0, 0, 0, 0, time.UTC)

	// No sampling must never pretend 0 ms is a valid recent performance metric.
	o.observeRequest("GET", "/api/v1/nodes/:id/children", 200, 20*time.Millisecond)
	empty := s.snapshotRecentStoragePerformance(start.Add(time.Minute))
	if empty == nil || empty.Available || empty.WindowSeconds != 0 || empty.StartedAt != nil {
		t.Fatalf("no background sampler must show unavailable, got %+v", empty)
	}

	s.recordStoragePerformanceSample(start)
	o.observeRequest("GET", "/api/v1/nodes/:id/children", 200, 10*time.Millisecond)
	o.observeRequest("GET", "/api/v1/nodes/:id/children", 503, 30*time.Millisecond)
	o.observeRequest("GET", "/api/v1/media/items/:id/thumbnail", 404, 5*time.Millisecond)
	o.observeRequest("GET", "/api/v1/nodes/123/secret.jpg", 200, 30*time.Millisecond)
	short := s.snapshotRecentStoragePerformance(start.Add(time.Minute))
	if !short.Available || !short.WarmingUp || short.WindowSeconds != 60 {
		t.Fatalf("unexpected first 60 seconds: %+v", short)
	}
	files := short.Rows[0]
	if files.Key != "files_list" || files.Requests != 2 || files.ServerErrors != 1 ||
		math.Abs(files.AverageMS-20) > 1e-6 || math.Abs(files.RequestsPerSecond-2.0/60) > 1e-9 {
		t.Fatalf("incorrect file-list recent delta: %+v", files)
	}
	if preview := short.Rows[2]; preview.Requests != 1 || preview.ServerErrors != 0 {
		t.Fatalf("valid HTTP 404 cannot count as 5xx: %+v", preview)
	}
	if len(short.Rows) != len(storagePerformanceKeys) || len(o.httpRequests) != 4 {
		t.Fatalf("unbounded recent labels or unexpected source cardinality: %+v", short)
	}
}

func TestStoragePerformanceRecentSlidingWindowAndRestartReset(t *testing.T) {
	o := newServerObservability(nil)
	s := &Server{obs: o}
	start := time.Date(2026, 10, 17, 0, 0, 0, 0, time.UTC)
	for minute := 0; minute <= 7; minute++ {
		s.recordStoragePerformanceSample(start.Add(time.Duration(minute) * time.Minute))
		// Each minute adds precisely one operation after its baseline.
		o.observeRequest("PUT", "/api/v1/uploads/:id/chunks/:index", 200, 8*time.Millisecond)
	}
	when := start.Add(7*time.Minute + 15*time.Second)
	got := s.snapshotRecentStoragePerformance(when)
	if !got.Available || got.WindowSeconds != 255 || got.StartedAt == nil || !got.StartedAt.Equal(start.Add(3*time.Minute)) {
		t.Fatalf("wrong bounded 5 minute sample coverage: %+v", got)
	}
	// The ring retains only seven 1-minute checkpoints, not one item per HTTP request.
	if s.storagePerformanceSamples.count != storagePerformanceSampleSlot {
		t.Fatalf("window storage is not constant size: %d", s.storagePerformanceSamples.count)
	}
	u := got.Rows[4]
	if u.Requests != 5 || u.ServerErrors != 0 || math.Abs(u.AverageMS-8) > 1e-6 {
		t.Fatalf("recent PUT delta incorrectly includes old requests: %+v", u)
	}
	if got.WarmingUp {
		t.Fatal("a mature 255-second rolling sample window must not say warming up")
	}
	stale := s.snapshotRecentStoragePerformance(start.Add(11 * time.Minute))
	if stale.Available || stale.WindowSeconds != 0 || stale.StartedAt != nil {
		t.Fatalf("stopped sampler must not claim current window metrics: %+v", stale)
	}

	// A restarted Server must not mix pre-restart process counters or samples.
	restarted := &Server{obs: newServerObservability(nil)}
	restarted.recordStoragePerformanceSample(when)
	if a := restarted.snapshotRecentStoragePerformance(when.Add(time.Second)); !a.Available {
		t.Fatal("restart baseline should be available with honest 1s window")
	}
	s.recordStoragePerformanceSample(start.Add(-time.Hour))
	if s.storagePerformanceSamples.count != 1 {
		t.Fatal("wall-clock regression must discard old window")
	}
}

func TestStoragePerformanceRecentNoLeaksAfter100kSyntheticRequests(t *testing.T) {
	o := newServerObservability(nil)
	s := &Server{obs: o}
	t0 := time.Now().UTC()
	s.recordStoragePerformanceSample(t0)
	for i := 0; i < 100000; i++ {
		o.observeRequest("GET", "/api/v1/media/items", 200, time.Millisecond)
	}
	s.recordStoragePerformanceSample(t0.Add(time.Minute))
	got := s.snapshotRecentStoragePerformance(t0.Add(2 * time.Minute))
	if got == nil || len(got.Rows) != len(storagePerformanceKeys) ||
		got.Rows[1].Requests != 100000 || len(o.httpRequests) != 1 {
		t.Fatalf("100k requests must remain bounded in-memory: %+v", got)
	}
}

func BenchmarkStoragePerformanceRecentSample(b *testing.B) {
	o := newServerObservability(nil)
	s := &Server{obs: o}
	for i := 0; i < 100; i++ {
		o.observeRequest("GET", "/api/v1/nodes/:id/children", 200, time.Millisecond)
		o.observeRequest("PUT", "/api/v1/uploads/:id/chunks/:index", 200, time.Millisecond)
	}
	now := time.Now()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s.recordStoragePerformanceSample(now.Add(time.Duration(i) * time.Minute))
	}
}

func BenchmarkStoragePerformanceRecentRead(b *testing.B) {
	o := newServerObservability(nil)
	s := &Server{obs: o}
	now := time.Now()
	s.recordStoragePerformanceSample(now)
	for i := 0; i < 100; i++ {
		o.observeRequest("GET", "/api/v1/nodes/:id/children", 200, time.Millisecond)
	}
	s.recordStoragePerformanceSample(now.Add(time.Minute))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s.snapshotRecentStoragePerformance(now.Add(2 * time.Minute))
	}
}
