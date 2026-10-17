package api

import "time"

// Admin global-storage performance summary. It reuses the existing HTTP
// observability counters: no new per-request timers, labels, locks or IO.
// These values are process-local cumulative HTTP handler durations (including
// streaming to clients), not CPU time, throughput, p95, or durable task latency.
type storagePerformanceRowDTO struct {
	Key          string  `json:"key"`
	Requests     uint64  `json:"requests"`
	ServerErrors uint64  `json:"server_errors"`
	AverageMS    float64 `json:"average_ms"`
}

type storagePerformanceDTO struct {
	StartedAt  time.Time                  `json:"started_at"`
	CapturedAt time.Time                  `json:"captured_at"`
	Rows       []storagePerformanceRowDTO `json:"rows"`
}

var storagePerformanceKeys = [...]string{
	"files_list",
	"gallery_list",
	"preview",
	"download",
	"upload_chunk",
	"upload_finalize",
	"operation_enqueue",
	"delete_request",
	"changefeed",
}

// Only predefined route *templates* can appear in the admin response.
// Never include real paths, node IDs, account IDs, filenames or raw URLs.
func storagePerformanceCategory(method, route string) int {
	switch {
	case method == "GET" && (route == "/api/v1/nodes/:id/children" ||
		route == "/api/v1/nodes/:id/children/position"):
		return 0
	case method == "GET" && (route == "/api/v1/media/items" ||
		route == "/api/v1/media/facets" ||
		route == "/api/v1/media/places/viewport"):
		return 1
	case method == "GET" && (route == "/api/v1/media/items/:id/thumbnail" ||
		route == "/api/v1/file-preview/:id"):
		return 2
	case method == "GET" && (route == "/api/v1/files/:id/content" ||
		route == "/api/v1/files/:id/versions/:versionID/content" ||
		route == "/api/v1/file-download/:id" ||
		route == "/api/v1/file-version-download/:id/:versionID" ||
		route == "/api/v1/archive-download/:id"):
		return 3
	case method == "PUT" && route == "/api/v1/uploads/:id/chunks/:index":
		return 4
	case method == "POST" && route == "/api/v1/uploads/:id/finalize":
		return 5
	case method == "POST" && route == "/api/v1/file-operations":
		return 6
	case (method == "DELETE" && (route == "/api/v1/nodes/:id" ||
		route == "/api/v1/trash/:id")) ||
		(method == "POST" && route == "/api/v1/nodes/batch/delete"):
		return 7
	case method == "GET" && route == "/api/v1/changes":
		return 8
	default:
		return -1
	}
}

// This runs only when an administrator explicitly reads Global Storage.
// The normal HTTP request accounting in observeRequest is unchanged.
func (s *Server) snapshotStoragePerformance() *storagePerformanceDTO {
	if s == nil || s.obs == nil {
		return nil
	}
	o := s.obs
	result := &storagePerformanceDTO{
		CapturedAt: time.Now().UTC(),
		Rows:       make([]storagePerformanceRowDTO, len(storagePerformanceKeys)),
	}
	for i, key := range storagePerformanceKeys {
		result.Rows[i].Key = key
	}
	var durations [len(storagePerformanceKeys)]float64
	o.mu.Lock()
	result.StartedAt = o.startedAt
	for key, value := range o.httpRequests {
		idx := storagePerformanceCategory(key.Method, key.Route)
		if idx < 0 {
			continue
		}
		row := &result.Rows[idx]
		row.Requests += value.Count
		if key.Status >= 500 {
			row.ServerErrors += value.Count
		}
		durations[idx] += value.DurationSeconds
	}
	o.mu.Unlock()
	for i := range result.Rows {
		if result.Rows[i].Requests > 0 {
			result.Rows[i].AverageMS = durations[i] * 1000 / float64(result.Rows[i].Requests)
		}
	}
	return result
}
