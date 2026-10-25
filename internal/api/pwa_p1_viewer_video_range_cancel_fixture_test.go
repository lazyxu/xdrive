package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

// P1-D opt-in fixture: the same genuine 12-frame H264 movie, with a legal
// 2 MiB trailing ISO-BMFF free box, so browser playback can show frames
// while the signed original HTTP Range request remains in flight. Only
// bounded visible Owner video Nodes are bound, not all 115k physical sources.
func pwaP1SeedSlowOriginalH264Videos(
	t *testing.T, db *gorm.DB, store *fileExplorerMediaPerfStore,
	ownerID uint64, ids []uint64,
) int {
	t.Helper()
	if len(ids) < 1 || len(ids) > 100 {
		t.Fatalf("P1-D bounded original H264 video IDs invalid: %d", len(ids))
	}
	movie, err := base64.StdEncoding.DecodeString(galleryFirstVisibleVideoMP4Base64)
	if err != nil || len(movie) < 1000 || !bytes.Contains(movie[:min(len(movie), 128)], []byte("ftyp")) {
		t.Fatalf("P1-D actual decodable H264 missing: bytes=%d err=%v", len(movie), err)
	}
	// Append rather than prepend: original moov+mdat remain byte-identical.
	// The free box is a valid top-level ISO BMFF box, not fake H264 frames.
	const freeLength = 2 << 20
	free := make([]byte, freeLength)
	binary.BigEndian.PutUint32(free[:4], uint32(freeLength))
	copy(free[4:8], "free")
	source := append(movie, free...)
	digest := fmt.Sprintf("%x", sha256.Sum256(source))
	key, err := storage.ContentAddressedKey(digest)
	if err != nil {
		t.Fatal(err)
	}
	if written, err := store.Put(t.Context(), key, bytes.NewReader(source)); err != nil || written != int64(len(source)) {
		t.Fatalf("P1-D real signed-video physical CAS Put: written=%d err=%v", written, err)
	}
	m := db.Model(&meta.File{}).Where("node_id IN ?", ids).
		Updates(map[string]any{"storage_key": key, "sha256": digest, "size": int64(len(source))})
	if m.Error != nil || m.RowsAffected != int64(len(ids)) {
		t.Fatalf("P1-D video File CAS projection: rows=%d err=%v", m.RowsAffected, m.Error)
	}
	m = db.Model(&meta.MediaMetadata{}).Where("owner_id=? AND node_id IN ?", ownerID, ids).
		Updates(map[string]any{"sha256": digest, "width": 96, "height": 64})
	if m.Error != nil || m.RowsAffected != int64(len(ids)) {
		t.Fatalf("P1-D Owner-scoped video Metadata projection: rows=%d err=%v", m.RowsAffected, m.Error)
	}
	m = db.Model(&meta.PhotoResource{}).Where("node_id IN ?", ids).
		Updates(map[string]any{"sha256": digest, "size": int64(len(source))})
	if m.Error != nil || m.RowsAffected != int64(len(ids)) {
		t.Fatalf("P1-D existing canonical video PhotoResource projection: rows=%d err=%v", m.RowsAffected, m.Error)
	}
	return len(ids)
}

// pwaP1ViewerVideoRangeProbe wraps ONLY the existing authenticated signed
// original video GET /api/v1/file-preview/<NodeID>?ticket=... . The real
// router still validates Owner, ticket, Node revision and CAS bytes; no API
// mocks or JS AbortControllers are involved in this Viewer Back test.
type pwaP1ViewerVideoRangeProbe struct {
	watched         map[string]struct{}
	enabled         atomic.Bool
	started         atomic.Int64
	signedRange     atomic.Int64
	signedNoRange   atomic.Int64
	partialContent  atomic.Int64
	firstChunks     atomic.Int64
	active          atomic.Int64
	contextDone     atomic.Int64
	cancelled       atomic.Int64
	emittedBytes    atomic.Int64
	markBytes       atomic.Int64
	markNano        atomic.Int64
	maxCancelMicros atomic.Int64
}

func newPwaP1ViewerVideoRangeProbe(ids []uint64) *pwaP1ViewerVideoRangeProbe {
	watched := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		watched[fmt.Sprintf("/api/v1/file-preview/%d", id)] = struct{}{}
	}
	return &pwaP1ViewerVideoRangeProbe{watched: watched}
}

func (p *pwaP1ViewerVideoRangeProbe) matches(r *http.Request) bool {
	if p == nil || !p.enabled.Load() || r.Method != http.MethodGet {
		return false
	}
	if !r.URL.Query().Has("ticket") {
		return false
	}
	_, ok := p.watched[r.URL.Path]
	return ok
}

func (p *pwaP1ViewerVideoRangeProbe) start() {
	p.enabled.Store(true)
}

func (p *pwaP1ViewerVideoRangeProbe) mark() {
	p.markBytes.Store(p.emittedBytes.Load())
	p.maxCancelMicros.Store(0)
	p.markNano.Store(time.Now().UnixNano())
}

func (p *pwaP1ViewerVideoRangeProbe) snapshot() map[string]int64 {
	return map[string]int64{
		"watched_paths":      int64(len(p.watched)),
		"started":            p.started.Load(),
		"signed_range":       p.signedRange.Load(),
		"signed_no_range":    p.signedNoRange.Load(),
		"partial_content":    p.partialContent.Load(),
		"first_chunks":       p.firstChunks.Load(),
		"active":             p.active.Load(),
		"context_done":       p.contextDone.Load(),
		"cancelled":          p.cancelled.Load(),
		"emitted_bytes":      p.emittedBytes.Load(),
		"mark_emitted_bytes": p.markBytes.Load(),
		"max_cancel_us":      p.maxCancelMicros.Load(),
	}
}

func (p *pwaP1ViewerVideoRangeProbe) serve(w http.ResponseWriter, r *http.Request, next http.Handler) {
	// Separate real native Chrome Range and plain GET without storing URLs,
	// credentials or query-string secrets. Only Range is delayed for Abort.
	rangeRequest := strings.HasPrefix(r.Header.Get("Range"), "bytes=")
	if rangeRequest {
		p.signedRange.Add(1)
	} else {
		p.signedNoRange.Add(1)
	}
	p.started.Add(1)
	p.active.Add(1)
	defer p.active.Add(-1)
	ctx := r.Context()
	go func() {
		<-ctx.Done()
		if ctx.Err() != context.Canceled {
			return
		}
		p.contextDone.Add(1)
		mark := p.markNano.Load()
		if mark == 0 {
			return
		}
		latency := time.Since(time.Unix(0, mark)).Microseconds()
		for {
			old := p.maxCancelMicros.Load()
			if latency <= old || p.maxCancelMicros.CompareAndSwap(old, latency) {
				break
			}
		}
	}()
	next.ServeHTTP(&pwaP1ViewerVideoRangeWriter{
		ResponseWriter: w, ctx: ctx, probe: p, delayRange: rangeRequest,
	}, r)
	if ctx.Err() == context.Canceled {
		p.cancelled.Add(1)
	}
}

type pwaP1ViewerVideoRangeWriter struct {
	http.ResponseWriter
	ctx        context.Context
	probe      *pwaP1ViewerVideoRangeProbe
	delayRange bool
	first      bool
}

func (w *pwaP1ViewerVideoRangeWriter) WriteHeader(status int) {
	if status == http.StatusPartialContent {
		w.probe.partialContent.Add(1)
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *pwaP1ViewerVideoRangeWriter) Write(data []byte) (int, error) {
	if len(data) == 0 {
		return 0, nil
	}
	// A plain browser GET is diagnostic evidence, never a false Range PASS.
	// Do not artificially delay otherwise functional non-Range playback.
	if !w.delayRange {
		n, err := w.ResponseWriter.Write(data)
		w.probe.emittedBytes.Add(int64(n))
		return n, err
	}
	if !w.first {
		w.first = true
		// The 12-frame moov+mdat is <4 KiB; real browser playback can
		// decode it before the remaining legal free box finishes streaming.
		first := min(4096, len(data))
		n, err := w.ResponseWriter.Write(data[:first])
		w.probe.emittedBytes.Add(int64(n))
		if n > 0 {
			w.probe.firstChunks.Add(1)
		}
		w.Flush()
		if err != nil || n != first {
			return n, err
		}
		timer := time.NewTimer(5 * time.Second)
		defer timer.Stop()
		select {
		case <-w.ctx.Done():
			return n, w.ctx.Err()
		case <-timer.C:
		}
		if first == len(data) {
			return n, nil
		}
		m, writeErr := w.ResponseWriter.Write(data[first:])
		w.probe.emittedBytes.Add(int64(m))
		return n + m, writeErr
	}
	n, err := w.ResponseWriter.Write(data)
	w.probe.emittedBytes.Add(int64(n))
	return n, err
}

func (w *pwaP1ViewerVideoRangeWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
