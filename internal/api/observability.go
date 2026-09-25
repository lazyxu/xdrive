package api

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

type httpMetricKey struct {
	Method string
	Route  string
	Status int
}

type httpMetricValue struct {
	Count           uint64
	DurationSeconds float64
}

type uploadMetricKey struct {
	Operation string
	Result    string
}

type serverObservability struct {
	mu sync.Mutex

	startedAt time.Time
	logger    *slog.Logger

	httpRequests map[httpMetricKey]httpMetricValue
	uploads      map[uploadMetricKey]uint64

	loginFailures    uint64
	quotaRejections  uint64
	api5xx           uint64
	collectionErrors uint64
}

type liveMetrics struct {
	DatabaseSizeBytes    int64
	ActiveUploadSessions int64
	RetainedBlobBytes    int64
	StagingBlobBytes     int64
	RetainedBlobObjects  int64
	StagingBlobObjects   int64
	DBOpenConnections    int
	DBInUseConnections   int
	DBIdleConnections    int
	DBWaitCount          int64
}

func newServerObservability(logger *slog.Logger) *serverObservability {
	if logger == nil {
		logger = slog.Default()
	}
	return &serverObservability{
		startedAt:    time.Now().UTC(),
		logger:       logger,
		httpRequests: make(map[httpMetricKey]httpMetricValue),
		uploads:      make(map[uploadMetricKey]uint64),
	}
}

func (s *Server) ensureObservability() {
	if s.obs == nil {
		s.obs = newServerObservability(slog.Default())
	}
}

func (s *Server) requestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := strings.TrimSpace(c.GetHeader("X-Request-ID"))
		if !validRequestID(requestID) {
			requestID = uuid.NewString()
		}
		c.Request.Header.Set("X-Request-ID", requestID)
		c.Header("X-Request-ID", requestID)
		c.Set("requestID", requestID)
		c.Next()
	}
}

func validRequestID(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '-', r == '_', r == '.', r == ':':
		default:
			return false
		}
	}
	return true
}

func requestIDFromContext(c *gin.Context) string {
	if value, ok := c.Get("requestID"); ok {
		if requestID, ok := value.(string); ok {
			return requestID
		}
	}
	return strings.TrimSpace(c.GetHeader("X-Request-ID"))
}

func (s *Server) recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				route := c.FullPath()
				if route == "" {
					route = "unmatched"
				}
				s.obs.logger.Error("http_panic",
					"request_id", requestIDFromContext(c),
					"method", c.Request.Method,
					"route", route,
					"panic", fmt.Sprint(recovered),
					"stack", string(debug.Stack()),
				)
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			}
		}()
		c.Next()
	}
}

func (s *Server) observeHTTP() gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		c.Next()

		status := c.Writer.Status()
		route := c.FullPath()
		if route == "" {
			route = "unmatched"
		}
		duration := time.Since(started)
		s.obs.observeRequest(c.Request.Method, route, status, duration)

		if isQuietProbe(route) && status < http.StatusBadRequest {
			return
		}
		attrs := []any{
			"request_id", requestIDFromContext(c),
			"method", c.Request.Method,
			"route", route,
			"status", status,
			"duration_ms", float64(duration.Microseconds()) / 1000,
			"response_bytes", c.Writer.Size(),
			"client_ip", clientIPAddress(c),
		}
		if uid := userID(c); uid != 0 {
			attrs = append(attrs, "user_id", uid)
		}
		s.obs.logger.Info("http_access", attrs...)
	}
}

func isQuietProbe(route string) bool {
	switch route {
	case "/api/v1/healthz", "/api/v1/readyz", "/metrics":
		return true
	default:
		return false
	}
}

func (o *serverObservability) observeRequest(method, route string, status int, duration time.Duration) {
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

func uploadOperation(method, route string) string {
	switch {
	case method == http.MethodPost && route == "/api/v1/nodes/:id/files":
		return "multipart"
	case method == http.MethodPut && route == "/api/v1/files/:id/content":
		return "overwrite"
	case method == http.MethodPost && route == "/api/v1/uploads":
		return "session_create"
	case method == http.MethodPut && route == "/api/v1/uploads/:id/chunks/:index":
		return "chunk"
	case method == http.MethodPost && route == "/api/v1/uploads/:id/finalize":
		return "finalize"
	case method == http.MethodDelete && route == "/api/v1/uploads/:id":
		return "abort"
	default:
		return ""
	}
}

func (o *serverObservability) noteUpload(operation, result string) {
	o.mu.Lock()
	o.uploads[uploadMetricKey{Operation: operation, Result: result}]++
	o.mu.Unlock()
}

func (o *serverObservability) noteCollectionError() {
	o.mu.Lock()
	o.collectionErrors++
	o.mu.Unlock()
}

func (s *Server) metrics(c *gin.Context) {
	c.Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	c.Header("Cache-Control", "no-store")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()

	live, err := s.collectLiveMetrics(ctx)
	collectionOK := 1
	if err != nil {
		collectionOK = 0
		s.obs.noteCollectionError()
		s.obs.logger.Warn("metrics_collection_failed",
			"request_id", requestIDFromContext(c),
			"error", err.Error(),
		)
	}

	s.obs.mu.Lock()
	requests := make(map[httpMetricKey]httpMetricValue, len(s.obs.httpRequests))
	for key, value := range s.obs.httpRequests {
		requests[key] = value
	}
	uploads := make(map[uploadMetricKey]uint64, len(s.obs.uploads))
	for key, value := range s.obs.uploads {
		uploads[key] = value
	}
	loginFailures := s.obs.loginFailures
	quotaRejections := s.obs.quotaRejections
	api5xx := s.obs.api5xx
	collectionErrors := s.obs.collectionErrors
	uptime := time.Since(s.obs.startedAt).Seconds()
	s.obs.mu.Unlock()

	var b strings.Builder
	fmt.Fprintln(&b, "# HELP xdrive_uptime_seconds Time since the API process initialized observability.")
	fmt.Fprintln(&b, "# TYPE xdrive_uptime_seconds gauge")
	fmt.Fprintf(&b, "xdrive_uptime_seconds %.3f\n", uptime)

	fmt.Fprintln(&b, "# HELP xdrive_http_requests_total HTTP requests grouped by method, route template, and status.")
	fmt.Fprintln(&b, "# TYPE xdrive_http_requests_total counter")
	httpKeys := make([]httpMetricKey, 0, len(requests))
	for key := range requests {
		httpKeys = append(httpKeys, key)
	}
	sort.Slice(httpKeys, func(i, j int) bool {
		a, z := httpKeys[i], httpKeys[j]
		if a.Route != z.Route {
			return a.Route < z.Route
		}
		if a.Method != z.Method {
			return a.Method < z.Method
		}
		return a.Status < z.Status
	})
	for _, key := range httpKeys {
		value := requests[key]
		fmt.Fprintf(&b, "xdrive_http_requests_total{method=%q,route=%q,status=%q} %d\n",
			key.Method, key.Route, strconv.Itoa(key.Status), value.Count)
	}

	fmt.Fprintln(&b, "# HELP xdrive_http_request_duration_seconds HTTP request duration by method and route template.")
	fmt.Fprintln(&b, "# TYPE xdrive_http_request_duration_seconds summary")
	type durationKey struct {
		Method string
		Route  string
	}
	durationValues := make(map[durationKey]httpMetricValue)
	for key, value := range requests {
		dk := durationKey{Method: key.Method, Route: key.Route}
		current := durationValues[dk]
		current.Count += value.Count
		current.DurationSeconds += value.DurationSeconds
		durationValues[dk] = current
	}
	durationKeys := make([]durationKey, 0, len(durationValues))
	for key := range durationValues {
		durationKeys = append(durationKeys, key)
	}
	sort.Slice(durationKeys, func(i, j int) bool {
		if durationKeys[i].Route != durationKeys[j].Route {
			return durationKeys[i].Route < durationKeys[j].Route
		}
		return durationKeys[i].Method < durationKeys[j].Method
	})
	for _, key := range durationKeys {
		value := durationValues[key]
		fmt.Fprintf(&b, "xdrive_http_request_duration_seconds_sum{method=%q,route=%q} %.6f\n",
			key.Method, key.Route, value.DurationSeconds)
		fmt.Fprintf(&b, "xdrive_http_request_duration_seconds_count{method=%q,route=%q} %d\n",
			key.Method, key.Route, value.Count)
	}

	fmt.Fprintln(&b, "# HELP xdrive_api_5xx_total HTTP responses with status >= 500.")
	fmt.Fprintln(&b, "# TYPE xdrive_api_5xx_total counter")
	fmt.Fprintf(&b, "xdrive_api_5xx_total %d\n", api5xx)

	fmt.Fprintln(&b, "# HELP xdrive_login_failures_total Login requests returning an error response.")
	fmt.Fprintln(&b, "# TYPE xdrive_login_failures_total counter")
	fmt.Fprintf(&b, "xdrive_login_failures_total %d\n", loginFailures)

	fmt.Fprintln(&b, "# HELP xdrive_quota_rejections_total Requests rejected because retained data would exceed user quota.")
	fmt.Fprintln(&b, "# TYPE xdrive_quota_rejections_total counter")
	fmt.Fprintf(&b, "xdrive_quota_rejections_total %d\n", quotaRejections)

	fmt.Fprintln(&b, "# HELP xdrive_upload_operations_total Upload-related requests grouped by operation and result.")
	fmt.Fprintln(&b, "# TYPE xdrive_upload_operations_total counter")
	uploadKeys := make([]uploadMetricKey, 0, len(uploads))
	for key := range uploads {
		uploadKeys = append(uploadKeys, key)
	}
	sort.Slice(uploadKeys, func(i, j int) bool {
		if uploadKeys[i].Operation != uploadKeys[j].Operation {
			return uploadKeys[i].Operation < uploadKeys[j].Operation
		}
		return uploadKeys[i].Result < uploadKeys[j].Result
	})
	for _, key := range uploadKeys {
		fmt.Fprintf(&b, "xdrive_upload_operations_total{operation=%q,result=%q} %d\n",
			key.Operation, key.Result, uploads[key])
	}

	fmt.Fprintln(&b, "# HELP xdrive_metrics_collection_success Whether live DB-backed gauges were collected successfully.")
	fmt.Fprintln(&b, "# TYPE xdrive_metrics_collection_success gauge")
	fmt.Fprintf(&b, "xdrive_metrics_collection_success %d\n", collectionOK)
	fmt.Fprintln(&b, "# HELP xdrive_metrics_collection_errors_total Failed live metrics collection attempts.")
	fmt.Fprintln(&b, "# TYPE xdrive_metrics_collection_errors_total counter")
	fmt.Fprintf(&b, "xdrive_metrics_collection_errors_total %d\n", collectionErrors)

	if err == nil {
		fmt.Fprintln(&b, "# HELP xdrive_upload_sessions_active Currently active, non-expired upload sessions.")
		fmt.Fprintln(&b, "# TYPE xdrive_upload_sessions_active gauge")
		fmt.Fprintf(&b, "xdrive_upload_sessions_active %d\n", live.ActiveUploadSessions)

		fmt.Fprintln(&b, "# HELP xdrive_managed_blob_bytes Unique retained physical blob bytes plus non-reused upload staging chunks.")
		fmt.Fprintln(&b, "# TYPE xdrive_managed_blob_bytes gauge")
		fmt.Fprintf(&b, "xdrive_managed_blob_bytes %d\n", live.RetainedBlobBytes+live.StagingBlobBytes)
		fmt.Fprintln(&b, "# HELP xdrive_retained_blob_bytes Unique physical blob bytes referenced by current files and historical versions.")
		fmt.Fprintln(&b, "# TYPE xdrive_retained_blob_bytes gauge")
		fmt.Fprintf(&b, "xdrive_retained_blob_bytes %d\n", live.RetainedBlobBytes)
		fmt.Fprintln(&b, "# HELP xdrive_staging_blob_bytes Bytes stored by non-reused in-progress upload chunks.")
		fmt.Fprintln(&b, "# TYPE xdrive_staging_blob_bytes gauge")
		fmt.Fprintf(&b, "xdrive_staging_blob_bytes %d\n", live.StagingBlobBytes)
		fmt.Fprintln(&b, "# HELP xdrive_managed_blob_objects Unique retained physical blob objects plus staging blob objects.")
		fmt.Fprintln(&b, "# TYPE xdrive_managed_blob_objects gauge")
		fmt.Fprintf(&b, "xdrive_managed_blob_objects %d\n", live.RetainedBlobObjects+live.StagingBlobObjects)

		fmt.Fprintln(&b, "# HELP xdrive_database_size_bytes PostgreSQL size of the current xDrive database.")
		fmt.Fprintln(&b, "# TYPE xdrive_database_size_bytes gauge")
		fmt.Fprintf(&b, "xdrive_database_size_bytes %d\n", live.DatabaseSizeBytes)

		fmt.Fprintln(&b, "# HELP xdrive_db_connections_open Open SQL database connections.")
		fmt.Fprintln(&b, "# TYPE xdrive_db_connections_open gauge")
		fmt.Fprintf(&b, "xdrive_db_connections_open %d\n", live.DBOpenConnections)
		fmt.Fprintln(&b, "# HELP xdrive_db_connections_in_use SQL database connections currently in use.")
		fmt.Fprintln(&b, "# TYPE xdrive_db_connections_in_use gauge")
		fmt.Fprintf(&b, "xdrive_db_connections_in_use %d\n", live.DBInUseConnections)
		fmt.Fprintln(&b, "# HELP xdrive_db_connections_idle Idle SQL database connections.")
		fmt.Fprintln(&b, "# TYPE xdrive_db_connections_idle gauge")
		fmt.Fprintf(&b, "xdrive_db_connections_idle %d\n", live.DBIdleConnections)
		fmt.Fprintln(&b, "# HELP xdrive_db_connection_wait_total Total waits for an available SQL database connection.")
		fmt.Fprintln(&b, "# TYPE xdrive_db_connection_wait_total counter")
		fmt.Fprintf(&b, "xdrive_db_connection_wait_total %d\n", live.DBWaitCount)
	}

	c.Data(http.StatusOK, "text/plain; version=0.0.4; charset=utf-8", []byte(b.String()))
}

func (s *Server) collectLiveMetrics(ctx context.Context) (liveMetrics, error) {
	var live liveMetrics
	sqlDB, err := s.DB.DB()
	if err != nil {
		return live, err
	}
	dbStats := sqlDB.Stats()
	live.DBOpenConnections = dbStats.OpenConnections
	live.DBInUseConnections = dbStats.InUse
	live.DBIdleConnections = dbStats.Idle
	live.DBWaitCount = dbStats.WaitCount

	row := s.DB.WithContext(ctx).Raw(`SELECT
pg_database_size(current_database()) AS database_size_bytes,
(SELECT COUNT(*) FROM xd_upload_sessions WHERE status = ? AND expires_at > NOW()) AS active_upload_sessions,
COALESCE((
  SELECT SUM(size) FROM (
    SELECT storage_key, MAX(size) AS size
    FROM (
      SELECT storage_key, size FROM xd_files
      UNION ALL
      SELECT storage_key, size FROM xd_file_versions
    ) retained_refs
    GROUP BY storage_key
  ) unique_retained
), 0) AS retained_blob_bytes,
COALESCE((SELECT SUM(size) FROM xd_upload_parts WHERE reused = false), 0) AS staging_blob_bytes,
COALESCE((
  SELECT COUNT(*) FROM (
    SELECT storage_key
    FROM (
      SELECT storage_key FROM xd_files
      UNION ALL
      SELECT storage_key FROM xd_file_versions
    ) retained_refs
    GROUP BY storage_key
  ) unique_retained
), 0) AS retained_blob_objects,
(SELECT COUNT(*) FROM xd_upload_parts WHERE reused = false) AS staging_blob_objects`,
		meta.UploadStatusActive).Row()
	if err := row.Scan(
		&live.DatabaseSizeBytes,
		&live.ActiveUploadSessions,
		&live.RetainedBlobBytes,
		&live.StagingBlobBytes,
		&live.RetainedBlobObjects,
		&live.StagingBlobObjects,
	); err != nil {
		return live, err
	}
	return live, nil
}
