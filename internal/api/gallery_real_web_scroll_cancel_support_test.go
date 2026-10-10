package api

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// The probe is test-only. It wraps the unchanged authenticated production
// thumbnail route, measuring real client disconnects and response-body bytes.
type galleryRealWebScrollCancelProbe struct {
	watched         map[string]struct{}
	started         atomic.Int64
	firstChunks     atomic.Int64
	active          atomic.Int64
	contextDone     atomic.Int64
	cancelled       atomic.Int64
	emittedBytes    atomic.Int64
	markNano        atomic.Int64
	maxCancelMicros atomic.Int64
}

func newGalleryRealWebScrollCancelProbe(imageNodeIDs []uint64) *galleryRealWebScrollCancelProbe {
	watched := make(map[string]struct{}, len(imageNodeIDs))
	for _, id := range imageNodeIDs {
		watched[fmt.Sprintf("/api/v1/media/items/%d/thumbnail", id)] = struct{}{}
	}
	return &galleryRealWebScrollCancelProbe{watched: watched}
}

func (p *galleryRealWebScrollCancelProbe) matches(path string) bool {
	if p == nil {
		return false
	}
	_, ok := p.watched[path]
	return ok
}

func (p *galleryRealWebScrollCancelProbe) mark() {
	p.maxCancelMicros.Store(0)
	p.markNano.Store(time.Now().UnixNano())
}

func (p *galleryRealWebScrollCancelProbe) snapshot() map[string]int64 {
	return map[string]int64{
		"watched_paths":    int64(len(p.watched)),
		"started":          p.started.Load(),
		"first_chunks":     p.firstChunks.Load(),
		"active":           p.active.Load(),
		"context_done":     p.contextDone.Load(),
		"cancelled":        p.cancelled.Load(),
		"emitted_bytes":    p.emittedBytes.Load(),
		"max_cancel_us":    p.maxCancelMicros.Load(),
		"cancel_mark_nano": p.markNano.Load(),
	}
}

func (p *galleryRealWebScrollCancelProbe) serve(
	w http.ResponseWriter, r *http.Request, next http.Handler,
) {
	p.started.Add(1)
	p.active.Add(1)
	defer p.active.Add(-1)
	ctx := r.Context()
	go func() {
		<-ctx.Done()
		p.contextDone.Add(1)
		mark := p.markNano.Load()
		if mark <= 0 || ctx.Err() != context.Canceled {
			return
		}
		latency := time.Since(time.Unix(0, mark)).Microseconds()
		for latency > p.maxCancelMicros.Load() {
			current := p.maxCancelMicros.Load()
			if current >= latency || p.maxCancelMicros.CompareAndSwap(current, latency) {
				break
			}
		}
	}()
	next.ServeHTTP(&galleryRealWebScrollCancelWriter{
		ResponseWriter: w, ctx: ctx, probe: p,
	}, r)
	if ctx.Err() == context.Canceled {
		p.cancelled.Add(1)
	}
}

type galleryRealWebScrollCancelWriter struct {
	http.ResponseWriter
	ctx   context.Context
	probe *galleryRealWebScrollCancelProbe
}

func (w *galleryRealWebScrollCancelWriter) Write(data []byte) (int, error) {
	if len(data) == 0 {
		return 0, nil
	}
	first := min(len(data), 256)
	n, err := w.ResponseWriter.Write(data[:first])
	w.probe.emittedBytes.Add(int64(n))
	if n > 0 {
		w.probe.firstChunks.Add(1)
	}
	w.Flush()
	if err != nil || n != first {
		return n, err
	}
	timer := time.NewTimer(1500 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-w.ctx.Done():
		return n, w.ctx.Err()
	case <-timer.C:
	}
	if first == len(data) {
		return n, nil
	}
	m, nextErr := w.ResponseWriter.Write(data[first:])
	w.probe.emittedBytes.Add(int64(m))
	return n + m, nextErr
}

func (w *galleryRealWebScrollCancelWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Test-only guard ensures the watched image IDs match actual production
// thumbnail GET routes; unrelated Gallery queries retain normal behavior.
func galleryRealWebScrollCancelPath(id uint64) string {
	return strings.Join([]string{
		"", "api", "v1", "media", "items", strconv.FormatUint(id, 10), "thumbnail",
	}, "/")
}
