package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

// Generates 100k genuinely distinct *decodable* 80×64 JPEG source byte arrays.
// Each JPEG encodes a 20-bit visibly different tile pattern, not a fake SVG or
// a shared JPEG referenced by 100k metadata rows. Preparation is never timed
// as a user-visible viewport/decode performance result.
func fileExplorerPhysicalJPEG(index int) ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, 80, 64))
	bits := uint(index + 1)
	for tileY := 0; tileY < 4; tileY++ {
		for tileX := 0; tileX < 5; tileX++ {
			ink := color.RGBA{R: 18, G: 28, B: 48, A: 255}
			if bits&(1<<uint(tileY*5+tileX)) != 0 {
				ink = color.RGBA{R: 241, G: 233, B: 204, A: 255}
			}
			for y := tileY * 16; y < (tileY+1)*16; y++ {
				for x := tileX * 16; x < (tileX+1)*16; x++ {
					img.SetRGBA(x, y, ink)
				}
			}
		}
	}
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, img, &jpeg.Options{Quality: 88}); err != nil {
		return nil, err
	}
	return encoded.Bytes(), nil
}

// A batch of 256 source records uses 1024 bounded PostgreSQL bind parameters;
// the production FileExplorer handlers and SQL are never changed.
func seedFileExplorerDistinctPhysicalJPEG100K(t *testing.T, db *gorm.DB, store *fileExplorerMediaPerfStore, count int) int64 {
	t.Helper()
	const batchSize = 256
	args := make([]any, 0, batchSize*4)
	placeholders := make([]string, 0, batchSize)
	seen := make(map[string]struct{}, count)
	var sourceBytes int64
	flush := func() {
		if len(placeholders) == 0 {
			return
		}
		sql := `INSERT INTO file_explorer_real_scroll_variants (variant, sha256, storage_key, size) VALUES ` +
			strings.Join(placeholders, ",")
		if err := db.Exec(sql, args...).Error; err != nil {
			t.Fatalf("batch insert unique physical jpeg variants: %v", err)
		}
		args = args[:0]
		placeholders = placeholders[:0]
	}
	for i := 0; i < count; i++ {
		data, err := fileExplorerPhysicalJPEG(i)
		if err != nil {
			t.Fatal(err)
		}
		digest := fmt.Sprintf("%x", sha256.Sum256(data))
		if _, duplicate := seen[digest]; duplicate {
			t.Fatalf("generated JPEG CAS SHA was reused for distinct index %d", i)
		}
		seen[digest] = struct{}{}
		key, err := storage.ContentAddressedKey(digest)
		if err != nil {
			t.Fatal(err)
		}
		stored, err := store.Put(context.Background(), key, bytes.NewReader(data))
		if err != nil || stored != int64(len(data)) {
			t.Fatalf("physical jpeg %d CAS bytes=%d want=%d error=%v", i, stored, len(data), err)
		}
		sourceBytes += stored
		placeholders = append(placeholders, "(?,?,?,?)")
		args = append(args, i, digest, key, len(data))
		if len(placeholders) == batchSize {
			flush()
		}
	}
	flush()
	if len(seen) != count || sourceBytes < int64(count)*500 {
		t.Fatalf("insufficient distinct JPEGs=%d bytes=%d", len(seen), sourceBytes)
	}
	var persisted int64
	if err := db.Raw("SELECT COUNT(DISTINCT sha256) FROM file_explorer_real_scroll_variants").Scan(&persisted).Error; err != nil {
		t.Fatal(err)
	}
	if persisted != int64(count) {
		t.Fatalf("physical CAS original uniqueness: persisted=%d expected=%d", persisted, count)
	}
	for _, i := range []int{0, count / 2, count - 1} {
		raw, err := fileExplorerPhysicalJPEG(i)
		if err != nil {
			t.Fatal(err)
		}
		key, err := storage.ContentAddressedKey(fmt.Sprintf("%x", sha256.Sum256(raw)))
		if err != nil {
			t.Fatal(err)
		}
		body, err := store.Open(context.Background(), key)
		if err != nil {
			t.Fatalf("real CAS object %d missing: %v", i, err)
		}
		decoded, readErr := io.ReadAll(body)
		closeErr := body.Close()
		if readErr != nil || closeErr != nil || !bytes.Equal(decoded, raw) {
			t.Fatalf("real CAS original %d bytes mismatch: read=%v close=%v", i, readErr, closeErr)
		}
		img, err := jpeg.Decode(bytes.NewReader(decoded))
		if err != nil || img.Bounds().Dx() != 80 || img.Bounds().Dy() != 64 {
			t.Fatalf("distinct CAS original %d not decodable as 80x64 JPEG: %v", i, err)
		}
	}
	return sourceBytes
}

// Counts genuinely served authenticated production thumbnail routes without
// injecting a delay. The existing separate real-Go cancellation fixture keeps
// its original controlled 1.5s response writer and 160ms load-shedding gate.
type fileExplorerRealPhysicalProbe struct {
	started         atomic.Int64
	completed       atomic.Int64
	active          atomic.Int64
	maxActive       atomic.Int64
	bytes           atomic.Int64
	failed          atomic.Int64
	http5xxTotal    atomic.Int64
	http5xxCanceled atomic.Int64
	serverErrors    atomic.Int64
	canceled        atomic.Int64
}

func (p *fileExplorerRealPhysicalProbe) snapshot() map[string]int64 {
	return map[string]int64{
		"started": p.started.Load(), "completed": p.completed.Load(),
		"active": p.active.Load(), "max_active": p.maxActive.Load(),
		"response_bytes": p.bytes.Load(), "failed": p.failed.Load(),
		"http_5xx_total":    p.http5xxTotal.Load(),
		"http_5xx_canceled": p.http5xxCanceled.Load(),
		"server_errors":     p.serverErrors.Load(),
		"canceled":          p.canceled.Load(),
	}
}

func (p *fileExplorerRealPhysicalProbe) serve(w http.ResponseWriter, r *http.Request, router http.Handler) {
	p.started.Add(1)
	now := p.active.Add(1)
	for {
		peak := p.maxActive.Load()
		if now <= peak || p.maxActive.CompareAndSwap(peak, now) {
			break
		}
	}
	rec := &fileExplorerRealPhysicalResponse{ResponseWriter: w, code: http.StatusOK}
	router.ServeHTTP(rec, r)
	p.bytes.Add(rec.bytes)
	p.active.Add(-1)
	p.completed.Add(1)
	if rec.code >= 400 {
		cancelled := r.Context().Err() != nil
		if rec.code >= 500 {
			// Retain EVERY raw 5xx, even after a client closed the response stream.
			p.http5xxTotal.Add(1)
			if cancelled {
				p.http5xxCanceled.Add(1)
			} else {
				p.serverErrors.Add(1)
			}
		}
		if cancelled {
			// Old virtual range owns this canceled request. Gin may
			// write 404 after the PostgreSQL call sees Context canceled,
			// but this is not a missing physical CAS source.
			p.canceled.Add(1)
		} else {
			p.failed.Add(1)
		}
	}
}

type fileExplorerRealPhysicalResponse struct {
	http.ResponseWriter
	code  int
	bytes int64
}

func (w *fileExplorerRealPhysicalResponse) WriteHeader(code int) {
	w.code = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *fileExplorerRealPhysicalResponse) Write(p []byte) (int, error) {
	n, err := w.ResponseWriter.Write(p)
	w.bytes += int64(n)
	return n, err
}

func (w *fileExplorerRealPhysicalResponse) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// P038 instrumentation regression: distinguish an aborted request's internal
// Gin 500 write from an actual live-client Server 500 without concealing either.
// The original total5xx remains observable, and no production handler is altered.
func TestFileExplorerPhysicalProbeCanceled5xxAttribution(t *testing.T) {
	probe := &fileExplorerRealPhysicalProbe{}
	serve := func(status int, canceled bool) {
		t.Helper()
		request := httptest.NewRequest(http.MethodGet, "/media-probe", nil)
		if canceled {
			ctx, cancel := context.WithCancel(request.Context())
			cancel()
			request = request.WithContext(ctx)
		}
		recorder := httptest.NewRecorder()
		probe.serve(recorder, request, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
			_, _ = w.Write([]byte("diagnostic"))
		}))
		if recorder.Code != status {
			t.Fatalf("unexpected recorder code %d != %d", recorder.Code, status)
		}
	}
	serve(http.StatusInternalServerError, true)
	afterCancel := probe.snapshot()
	if afterCancel["http_5xx_total"] != 1 || afterCancel["http_5xx_canceled"] != 1 ||
		afterCancel["server_errors"] != 0 || afterCancel["canceled"] != 1 {
		t.Fatalf("canceled 500 was hidden or attributed to live Server failure: %+v", afterCancel)
	}
	serve(http.StatusInternalServerError, false)
	afterLiveError := probe.snapshot()
	if afterLiveError["http_5xx_total"] != 2 || afterLiveError["http_5xx_canceled"] != 1 ||
		afterLiveError["server_errors"] != 1 || afterLiveError["failed"] != 1 {
		t.Fatalf("genuine live 500 must remain a hard failure: %+v", afterLiveError)
	}
	serve(http.StatusNotFound, false) // cold video-poster miss, not 5xx
	afterPosterMiss := probe.snapshot()
	if afterPosterMiss["http_5xx_total"] != 2 || afterPosterMiss["server_errors"] != 1 ||
		afterPosterMiss["failed"] != 2 {
		t.Fatalf("cold poster miss must not become a Server 5xx: %+v", afterPosterMiss)
	}
}
