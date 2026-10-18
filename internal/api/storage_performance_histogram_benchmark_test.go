package api

// OBS-P003 SOURCE-EXACT control: this method body is an exact, checked copy
// of original production observeRequest in Git Blob 9a247e2b086d53f0b26bf03f6d8d8a7956b21e0a.
// Only the receiver/function header is adapted to allow candidate and baseline
// to be benchmarked in the SAME Go test binary/runner. It does not implement
// any metric histogram. CI must byte-compare to the frozen original Git Blob.
import (
	"net/http"
	"testing"
	"time"
)

func obsP003LegacyObserve(o *serverObservability, method, route string, status int, duration time.Duration) {
	o.mu.Lock()
	defer o.mu.Unlock()

	key := httpMetricKey{Method: method, Route: route, Status: status}
	value := o.httpRequests[key]
	value.Count++
	value.DurationSeconds += duration.Seconds()
	o.httpRequests[key] = value

	if status >= http.StatusInternalServerError {
		o.api5xx++
	}
	if route == "/api/v1/auth/login" && method == http.MethodPost &&
		(status == http.StatusUnauthorized || status == http.StatusForbidden) {
		o.loginFailures++
	}
	if status == http.StatusInsufficientStorage {
		o.quotaRejections++
	}
	if operation := uploadOperation(method, route); operation != "" {
		result := "success"
		if status >= http.StatusBadRequest {
			result = "failure"
		}
		o.uploads[uploadMetricKey{Operation: operation, Result: result}]++
	}
}

type obsP003Request struct {
	method, route string
	status        int
	duration      time.Duration
}

var obsP003Cases = [...]obsP003Request{
	{"GET", "/api/v1/nodes/:id/children", 200, 14 * time.Millisecond},
	{"GET", "/api/v1/media/items", 200, 13 * time.Millisecond},
	{"GET", "/api/v1/media/items/:id/thumbnail", 200, 45 * time.Millisecond},
	{"GET", "/api/v1/files/:id/content", 200, 250 * time.Millisecond},
	{"PUT", "/api/v1/uploads/:id/chunks/:index", 200, 400 * time.Millisecond},
	{"POST", "/api/v1/uploads/:id/finalize", 201, 130 * time.Millisecond},
	{"POST", "/api/v1/file-operations", 202, 6 * time.Millisecond},
	{"DELETE", "/api/v1/nodes/:id", 204, 4 * time.Millisecond},
	{"GET", "/api/v1/changes", 200, time.Millisecond},
}

func BenchmarkOBSP003OriginalSequential(b *testing.B) {
	o := newServerObservability(nil)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c := obsP003Cases[i%len(obsP003Cases)]
		obsP003LegacyObserve(o, c.method, c.route, c.status, c.duration)
	}
}

func BenchmarkOBSP003CandidateSequential(b *testing.B) {
	o := newServerObservability(nil)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c := obsP003Cases[i%len(obsP003Cases)]
		o.observeRequest(c.method, c.route, c.status, c.duration)
	}
}

func BenchmarkOBSP003OriginalParallel(b *testing.B) {
	o := newServerObservability(nil)
	b.ReportAllocs()
	b.SetParallelism(2)
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			c := obsP003Cases[i%len(obsP003Cases)]
			obsP003LegacyObserve(o, c.method, c.route, c.status, c.duration)
			i++
		}
	})
}

func BenchmarkOBSP003CandidateParallel(b *testing.B) {
	o := newServerObservability(nil)
	b.ReportAllocs()
	b.SetParallelism(2)
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			c := obsP003Cases[i%len(obsP003Cases)]
			o.observeRequest(c.method, c.route, c.status, c.duration)
			i++
		}
	})
}

func BenchmarkOBSP003PeriodicSample(b *testing.B) {
	o := newServerObservability(nil)
	s := &Server{obs: o}
	now := time.Now().UTC()
	for i := 0; i < 100; i++ {
		c := obsP003Cases[i%len(obsP003Cases)]
		o.observeRequest(c.method, c.route, c.status, c.duration)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s.recordStoragePerformanceSample(now.Add(time.Duration(i) * time.Minute))
	}
}

func BenchmarkOBSP003AdminRecentRead(b *testing.B) {
	o := newServerObservability(nil)
	s := &Server{obs: o}
	now := time.Now().UTC()
	s.recordStoragePerformanceSample(now)
	for i := 0; i < 100; i++ {
		c := obsP003Cases[i%len(obsP003Cases)]
		o.observeRequest(c.method, c.route, c.status, c.duration)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		result := s.snapshotRecentStoragePerformance(now.Add(time.Minute))
		if result == nil || !result.Available {
			b.Fatal("recent histogram snapshot unexpectedly unavailable")
		}
	}
}
