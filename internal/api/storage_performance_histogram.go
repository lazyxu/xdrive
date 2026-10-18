package api

import "time"

// OBS-P003: Bounded per-route-class histogram. Values are **upper bounds of
// duration buckets**, not exact request quantiles. Routes are the fixed nine
// OBS-P001 classes, not user paths or node identities. One uint64[9][25]
// array is stored under the EXISTING httpRequests mutex.
const storageP003BucketCount = 25

var storageP003Boundaries = [storageP003BucketCount - 1]time.Duration{
	250 * time.Microsecond,
	500 * time.Microsecond,
	1 * time.Millisecond,
	2 * time.Millisecond,
	3 * time.Millisecond,
	5 * time.Millisecond,
	8 * time.Millisecond,
	10 * time.Millisecond,
	15 * time.Millisecond,
	25 * time.Millisecond,
	40 * time.Millisecond,
	60 * time.Millisecond,
	100 * time.Millisecond,
	150 * time.Millisecond,
	250 * time.Millisecond,
	400 * time.Millisecond,
	600 * time.Millisecond,
	1 * time.Second,
	2 * time.Second,
	5 * time.Second,
	10 * time.Second,
	30 * time.Second,
	60 * time.Second,
	300 * time.Second,
}

type storageP003Histogram struct {
	bins [len(storagePerformanceKeys)][storageP003BucketCount]uint64
}

// This function does no allocation or IO; it is invoked INSIDE the existing
// o.mu critical section during observeRequest. No new mutex or route labels.
func storageP003BucketForDuration(duration time.Duration) int {
	// Durations below zero cannot be interpreted as valid HTTP timings.
	if duration < 0 {
		duration = 0
	}
	// Only 24 bounded comparisons, without allocating sort/search closures.
	lo, hi := 0, len(storageP003Boundaries)
	for lo < hi {
		mid := int(uint(lo+hi) >> 1)
		if duration <= storageP003Boundaries[mid] {
			hi = mid
		} else {
			lo = mid + 1
		}
	}
	return lo
}

// Finds the bucket containing the estimated p-th percentile. The upper
// edge is returned as a conservative estimate. An overflow bucket is
// deliberately NOT assigned a numeric bound; it would be misleading.
func storageP003QuantileUpperMS(bins [storageP003BucketCount]uint64, total uint64, percent uint64) (float64, bool) {
	if total == 0 || percent == 0 || percent > 100 {
		return 0, false
	}
	// Ceil(total * percent/100), avoiding possible uint64 overflow.
	target := (total/100)*percent + ((total%100)*percent+99)/100
	var cumulative uint64
	for index, count := range bins {
		cumulative += count
		if cumulative >= target {
			if index >= len(storageP003Boundaries) {
				return 0, false
			}
			return float64(storageP003Boundaries[index]) / float64(time.Millisecond), true
		}
	}
	return 0, false
}
