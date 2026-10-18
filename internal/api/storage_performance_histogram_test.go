package api

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"
	"unsafe"
)

func TestOBSP003BucketsAreBoundedAndOrdered(t *testing.T) {
	if unsafe.Sizeof(storageP003Histogram{}) > 2048 {
		t.Fatalf("fixed nine-route histogram exceeds 2KiB RAM budget: %d", unsafe.Sizeof(storageP003Histogram{}))
	}
	for i, upper := range storageP003Boundaries {
		if upper <= 0 || (i > 0 && upper <= storageP003Boundaries[i-1]) {
			t.Fatalf("bucket %d is not strictly increasing: %s", i, upper)
		}
		if idx := storageP003BucketForDuration(upper); idx != i {
			t.Fatalf("bucket upper edge: got %d want %d", idx, i)
		}
	}
	if storageP003BucketForDuration(-time.Nanosecond) != 0 ||
		storageP003BucketForDuration(301*time.Second) != storageP003BucketCount-1 {
		t.Fatal("negative/overflow duration mapping invalid")
	}
	empty := [storageP003BucketCount]uint64{}
	if _, ok := storageP003QuantileUpperMS(empty, 0, 95); ok {
		t.Fatal("no events cannot imply an available percentile")
	}
}

func TestOBSP003RecentP95P99AreConservativeBucketUpperBounds(t *testing.T) {
	o := newServerObservability(nil)
	s := &Server{obs: o}
	now := time.Date(2026, 10, 17, 0, 0, 0, 0, time.UTC)
	s.recordStoragePerformanceSample(now)
	for i := 0; i < 100; i++ {
		d := 10 * time.Millisecond
		if i >= 98 {
			d = 100 * time.Millisecond
		}
		o.observeRequest("GET", "/api/v1/nodes/:id/children", 200, d)
	}
	// Full private path is an unrecognized route template and MUST NOT appear.
	o.observeRequest("GET", "/api/v1/nodes/123/private.jpg", 200, time.Second)
	o.observeRequest("POST", "/api/v1/auth/login", 401, time.Second)
	got := s.snapshotRecentStoragePerformance(now.Add(time.Minute))
	if !got.Available || got.WindowSeconds != 60 || len(got.Rows) != len(storagePerformanceKeys) {
		t.Fatalf("incorrect bounded window: %+v", got)
	}
	row := got.Rows[0]
	if row.Requests != 100 || row.ServerErrors != 0 || row.P95UpperMS == nil || row.P99UpperMS == nil ||
		math.Abs(*row.P95UpperMS-10) > 0.00001 || math.Abs(*row.P99UpperMS-100) > 0.00001 {
		t.Fatalf("P95/P99 upper bucket distribution wrong: %+v", row)
	}
	if o.p003Histogram.bins[0][storageP003BucketForDuration(10*time.Millisecond)] != 98 {
		t.Fatalf("histogram lost 98 fast responses: %+v", o.p003Histogram)
	}
	for _, other := range got.Rows[1:] {
		if other.P95UpperMS != nil || other.P99UpperMS != nil {
			t.Fatalf("unobserved operation cannot invent quantiles: %+v", other)
		}
	}
	data, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	for _, leak := range []string{"private.jpg", "/api/v1/nodes/123", "/auth/login", "owner_id", "ip_address"} {
		if strings.Contains(string(data), leak) {
			t.Fatalf("private route/identity leaked in admin summary: %s", data)
		}
	}
}

func TestOBSP003OverflowNoInventedPercentile(t *testing.T) {
	o := newServerObservability(nil)
	s := &Server{obs: o}
	now := time.Now().UTC()
	s.recordStoragePerformanceSample(now)
	for i := 0; i < 100; i++ {
		o.observeRequest("GET", "/api/v1/media/items", 200, 301*time.Second)
	}
	fresh := s.snapshotRecentStoragePerformance(now.Add(time.Minute))
	if !fresh.Available || fresh.Rows[1].Requests != 100 ||
		fresh.Rows[1].P95UpperMS != nil || fresh.Rows[1].P99UpperMS != nil {
		t.Fatalf("overflows cannot be labeled <=300s p95/p99: %+v", fresh.Rows[1])
	}
	stale := s.snapshotRecentStoragePerformance(now.Add(10 * time.Minute))
	if stale.Available || stale.Rows[1].P95UpperMS != nil || stale.Rows[1].P99UpperMS != nil {
		t.Fatal("stopped storage sampler cannot report recent percentiles")
	}
}

func TestOBSP003Synthetic100kRequestsHaveConstantCardinality(t *testing.T) {
	o := newServerObservability(nil)
	s := &Server{obs: o}
	now := time.Now().UTC()
	s.recordStoragePerformanceSample(now)
	for i := 0; i < 100000; i++ {
		o.observeRequest("GET", "/api/v1/nodes/:id/children", 200, time.Millisecond)
	}
	s.recordStoragePerformanceSample(now.Add(time.Minute))
	got := s.snapshotRecentStoragePerformance(now.Add(2 * time.Minute))
	if got == nil || !got.Available || got.Rows[0].Requests != 100000 ||
		got.Rows[0].P95UpperMS == nil || got.Rows[0].P99UpperMS == nil {
		t.Fatalf("expected valid 100k synthetic bounded-window quantiles: %+v", got)
	}
	if len(o.httpRequests) != 1 || s.storagePerformanceSamples.count != 2 {
		t.Fatalf("100k request observations created unbounded cardinality: http=%d ring=%d", len(o.httpRequests), s.storagePerformanceSamples.count)
	}
}
