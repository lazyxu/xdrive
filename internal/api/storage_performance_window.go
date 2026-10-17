package api

import (
	"sync"
	"time"
)

// OBS-P002 reads existing request counters once per minute. OBS-P003 also
// copies a fixed 9×25 HTTP duration-bucket array, recorded inside the already
// existing request metrics mutex. No user, URL or file labels, persistent SQL
// writes, filesystem walk, extra mutex or request-driven timers.
const (
	storagePerformancePeriod     = time.Minute
	storagePerformanceWindow     = 5 * time.Minute
	storagePerformanceSampleSlot = 7
)

type storageRecentPerformanceRowDTO struct {
	Key               string   `json:"key"`
	Requests          uint64   `json:"requests"`
	ServerErrors      uint64   `json:"server_errors"`
	AverageMS         float64  `json:"average_ms"`
	RequestsPerSecond float64  `json:"requests_per_second"`
	P95UpperMS        *float64 `json:"p95_upper_ms,omitempty"`
	P99UpperMS        *float64 `json:"p99_upper_ms,omitempty"`
}

type storageRecentPerformanceDTO struct {
	Available       bool                             `json:"available"`
	WarmingUp       bool                             `json:"warming_up"`
	CapturedAt      time.Time                        `json:"captured_at"`
	StartedAt       *time.Time                       `json:"started_at,omitempty"`
	WindowSeconds   int64                            `json:"window_seconds"`
	MaximumSeconds  int64                            `json:"maximum_seconds"`
	SamplingSeconds int64                            `json:"sampling_seconds"`
	Rows            []storageRecentPerformanceRowDTO `json:"rows"`
}

type storagePerformanceCounter struct {
	count    uint64
	errors   uint64
	duration float64
}

type storagePerformanceSample struct {
	at        time.Time
	counters  [len(storagePerformanceKeys)]storagePerformanceCounter
	histogram [len(storagePerformanceKeys)][storageP003BucketCount]uint64
}

type storagePerformanceSampleRing struct {
	mu      sync.Mutex
	entries [storagePerformanceSampleSlot]storagePerformanceSample
	next    int
	count   int
}

// Called only on the Server's preexisting 60s sampler goroutine and explicit
// Admin reads. The copy and classification reuse the existing observability
// lock: there is no additional collection/query for each HTTP request.
func (s *Server) storagePerformanceCounters(at time.Time) storagePerformanceSample {
	snapshot := storagePerformanceSample{at: at.UTC()}
	if s == nil || s.obs == nil {
		return snapshot
	}
	s.obs.mu.Lock()
	for key, value := range s.obs.httpRequests {
		idx := storagePerformanceCategory(key.Method, key.Route)
		if idx < 0 {
			continue
		}
		item := &snapshot.counters[idx]
		item.count += value.Count
		item.duration += value.DurationSeconds
		if key.Status >= 500 {
			item.errors += value.Count
		}
	}
	snapshot.histogram = s.obs.p003Histogram.bins
	s.obs.mu.Unlock()
	return snapshot
}

// Records constant-size counters independently of request cardinality.
// A backward clock resets history; an identical timestamp replaces its slot.
func (s *Server) recordStoragePerformanceSample(now time.Time) {
	if s == nil || s.obs == nil {
		return
	}
	current := s.storagePerformanceCounters(now)
	ring := &s.storagePerformanceSamples
	ring.mu.Lock()
	defer ring.mu.Unlock()

	if ring.count > 0 {
		previous := &ring.entries[(ring.next+storagePerformanceSampleSlot-1)%storagePerformanceSampleSlot]
		if !current.at.After(previous.at) {
			if current.at.Equal(previous.at) {
				*previous = current
				return
			}
			ring.next, ring.count = 0, 0
		}
	}
	ring.entries[ring.next] = current
	ring.next = (ring.next + 1) % storagePerformanceSampleSlot
	if ring.count < storagePerformanceSampleSlot {
		ring.count++
	}
}

// Provides real elapsed-time deltas, NEVER pretend that a 60s history is a
// complete five-minute window. Returned rows are bounded and anonymous.
// A stale sampler gap >2min suppresses values rather than fabricating rates.
func (s *Server) snapshotRecentStoragePerformance(now time.Time) *storageRecentPerformanceDTO {
	if s == nil || s.obs == nil {
		return nil
	}
	current := s.storagePerformanceCounters(now)
	result := &storageRecentPerformanceDTO{
		CapturedAt:      current.at,
		MaximumSeconds:  int64(storagePerformanceWindow / time.Second),
		SamplingSeconds: int64(storagePerformancePeriod / time.Second),
		WarmingUp:       true,
		Rows:            make([]storageRecentPerformanceRowDTO, len(storagePerformanceKeys)),
	}
	for i, key := range storagePerformanceKeys {
		result.Rows[i].Key = key
	}
	ring := &s.storagePerformanceSamples
	ring.mu.Lock()
	var first storagePerformanceSample
	var last storagePerformanceSample
	found := false
	for i := 0; i < ring.count; i++ {
		sample := ring.entries[(ring.next-ring.count+i+storagePerformanceSampleSlot)%storagePerformanceSampleSlot]
		age := current.at.Sub(sample.at)
		if age < 0 || age > storagePerformanceWindow {
			continue
		}
		if !found {
			first = sample
			found = true
		}
		last = sample
	}
	ring.mu.Unlock()
	if !found || current.at.Sub(last.at) > 2*storagePerformancePeriod {
		return result // no sampler, stale sampler, or future timestamp
	}
	elapsed := current.at.Sub(first.at)
	if elapsed < time.Second {
		return result
	}
	sec := elapsed.Seconds()
	result.Available = true
	result.WindowSeconds = int64(sec)
	result.WarmingUp = elapsed < 4*storagePerformancePeriod
	started := first.at
	result.StartedAt = &started
	for i := range result.Rows {
		before, after := first.counters[i], current.counters[i]
		if after.count < before.count || after.errors < before.errors || after.duration < before.duration {
			continue // cannot mix two Server generations or reset metrics
		}
		row := &result.Rows[i]
		row.Requests = after.count - before.count
		row.ServerErrors = after.errors - before.errors
		row.RequestsPerSecond = float64(row.Requests) / sec
		if row.Requests > 0 {
			row.AverageMS = (after.duration - before.duration) * 1000 / float64(row.Requests)
		}
		// Compare only closed, fixed-bound histograms of the SAME process and
		// same observed interval. Never infer quantiles from duration averages.
		var delta [storageP003BucketCount]uint64
		var total uint64
		consistent := true
		for bin := range delta {
			oldCount, newCount := first.histogram[i][bin], current.histogram[i][bin]
			if newCount < oldCount {
				consistent = false
				break
			}
			delta[bin] = newCount - oldCount
			total += delta[bin]
		}
		if consistent && total > 0 && total == row.Requests {
			if value, ok := storageP003QuantileUpperMS(delta, total, 95); ok {
				row.P95UpperMS = &value
			}
			if value, ok := storageP003QuantileUpperMS(delta, total, 99); ok {
				row.P99UpperMS = &value
			}
		}
	}
	return result
}
