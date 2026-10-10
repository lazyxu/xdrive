package api

import (
	"context"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm/logger"
)

// gallerySelectionSQLProfiler is test-only and excludes fixture creation,
// separate post-job correctness reads, and implicit transaction commit time.
// Its GORM Trace timings include client/observer overhead; not DB CPU/I/O.
type gallerySelectionSQLBucket struct {
	Statements   int64   `json:"statements"`
	SQLMS        float64 `json:"sql_ms"`
	SlowestSQLMS float64 `json:"slowest_sql_ms"`
}

type gallerySelectionSQLProfiler struct {
	logger.Interface
	mu      sync.Mutex
	phase   string
	buckets map[string]map[string]gallerySelectionSQLBucket
}

func newGallerySelectionSQLProfiler() *gallerySelectionSQLProfiler {
	return &gallerySelectionSQLProfiler{
		Interface: logger.Default,
		phase:     "enqueue",
		buckets:   make(map[string]map[string]gallerySelectionSQLBucket),
	}
}

func (p *gallerySelectionSQLProfiler) setPhase(phase string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.phase = phase
}

func (p *gallerySelectionSQLProfiler) Trace(_ context.Context, begin time.Time, fc func() (string, int64), _ error) {
	query, _ := fc()
	fields := strings.Fields(query)
	if len(fields) == 0 {
		return
	}
	verb := strings.ToUpper(fields[0])
	switch verb {
	case "SELECT", "INSERT", "UPDATE", "DELETE":
	default:
		return
	}
	elapsed := float64(time.Since(begin).Microseconds()) / 1000
	p.mu.Lock()
	defer p.mu.Unlock()
	phase := p.buckets[p.phase]
	if phase == nil {
		phase = make(map[string]gallerySelectionSQLBucket)
		p.buckets[p.phase] = phase
	}
	bucket := phase[verb]
	bucket.Statements++
	bucket.SQLMS += elapsed
	if elapsed > bucket.SlowestSQLMS {
		bucket.SlowestSQLMS = elapsed
	}
	phase[verb] = bucket
}

func (p *gallerySelectionSQLProfiler) snapshot() map[string]map[string]gallerySelectionSQLBucket {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make(map[string]map[string]gallerySelectionSQLBucket, len(p.buckets))
	for phase, verbs := range p.buckets {
		out[phase] = make(map[string]gallerySelectionSQLBucket, len(verbs))
		for verb, bucket := range verbs {
			out[phase][verb] = bucket
		}
	}
	return out
}
