//go:build linux

package api

import (
	"context"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm/logger"
)

// p059CopySQLProfile is test-only. It never records SQL, query arguments,
// bearer tokens, paths or individual source identifiers. The bounded category
// set is independent of the number of files or statements in the COPY.
type p059CopySQLProfile struct {
	logger.Interface
	mu      sync.Mutex
	count   int64
	wallNS  int64
	buckets map[string]p059SQLBucket
}

type p059SQLBucket struct {
	Statements int64   `json:"statements"`
	WallMS     float64 `json:"trace_wall_ms"`
	WorstMS    float64 `json:"worst_trace_wall_ms"`
}

func p059StatementCategory(query string) string {
	if len(query) > 4096 {
		query = query[:4096]
	}
	query = strings.ToLower(strings.TrimSpace(query))
	verb := "other"
	switch {
	case strings.HasPrefix(query, "select"):
		verb = "select"
	case strings.HasPrefix(query, "insert"):
		verb = "insert"
	case strings.HasPrefix(query, "update"):
		verb = "update"
	case strings.HasPrefix(query, "delete"):
		verb = "delete"
	case strings.HasPrefix(query, "with"):
		verb = "with"
	}
	target := "other"
	switch {
	case strings.Contains(query, "xd_content_blobs"):
		target = "content_blob"
	case strings.Contains(query, "xd_file_operations"):
		target = "operation"
	case strings.Contains(query, "xd_file_versions"):
		target = "file_version"
	case strings.Contains(query, "xd_files"):
		target = "file"
	case strings.Contains(query, "xd_nodes"):
		target = "node"
	}
	return verb + "_" + target
}

func (p *p059CopySQLProfile) Trace(_ context.Context, begin time.Time, fc func() (string, int64), _ error) {
	wallNS := time.Since(begin).Nanoseconds()
	query, _ := fc()
	category := p059StatementCategory(query)
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.buckets == nil {
		p.buckets = make(map[string]p059SQLBucket, 20)
	}
	bucket := p.buckets[category]
	bucket.Statements++
	bucket.WallMS += float64(wallNS) / 1e6
	if currentMS := float64(wallNS) / 1e6; currentMS > bucket.WorstMS {
		bucket.WorstMS = currentMS
	}
	p.buckets[category] = bucket
	p.count++
	p.wallNS += wallNS
}

func (p *p059CopySQLProfile) snapshot() map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	buckets := make(map[string]p059SQLBucket, len(p.buckets))
	var grouped int64
	for label, bucket := range p.buckets {
		buckets[label] = bucket
		grouped += bucket.Statements
	}
	return map[string]any{
		"statement_count":         p.count,
		"grouped_statement_count": grouped,
		"sum_sql_trace_wall_ms":   float64(p.wallNS) / 1e6,
		"statement_families":      buckets,
		"coverage":                "test-only worker GORM Trace spans; not PostgreSQL CPU, transaction commit, or complete Worker wall",
	}
}
