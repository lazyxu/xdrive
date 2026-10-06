package main

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestAgentMediaThumbnailCacheFreshHitSkipsLoader(t *testing.T) {
	now := time.Unix(1000, 0)
	cache := newAgentMediaThumbnailCache(8, 1<<20)
	cache.now = func() time.Time { return now }

	var calls atomic.Int64
	loader := func(etag string) (agentMediaThumbnailFetch, error) {
		calls.Add(1)
		if etag != "" {
			t.Fatalf("unexpected etag on first load: %q", etag)
		}
		return agentMediaThumbnailFetch{
			Thumbnail: agentMediaThumbnail{ContentType: "image/jpeg", Data: []byte("thumb")},
			ETag:      "\"etag-1\"",
			MaxAge:    time.Hour,
		}, nil
	}

	for i := 0; i < 3; i++ {
		got, err := cache.Load(context.Background(), "scope:1", loader)
		if err != nil {
			t.Fatal(err)
		}
		if string(got.Data) != "thumb" {
			t.Fatalf("data=%q", string(got.Data))
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("loader calls=%d want=1", got)
	}
}

func TestAgentMediaThumbnailCacheRevalidatesExpiredEntry(t *testing.T) {
	now := time.Unix(2000, 0)
	cache := newAgentMediaThumbnailCache(8, 1<<20)
	cache.now = func() time.Time { return now }

	var calls atomic.Int64
	loader := func(etag string) (agentMediaThumbnailFetch, error) {
		call := calls.Add(1)
		if call == 1 {
			return agentMediaThumbnailFetch{
				Thumbnail: agentMediaThumbnail{ContentType: "image/jpeg", Data: []byte("thumb")},
				ETag:      "\"etag-1\"",
				MaxAge:    time.Second,
			}, nil
		}
		if etag != "\"etag-1\"" {
			t.Fatalf("revalidation etag=%q", etag)
		}
		return agentMediaThumbnailFetch{
			ETag:        "\"etag-1\"",
			MaxAge:      time.Hour,
			NotModified: true,
		}, nil
	}

	if _, err := cache.Load(context.Background(), "scope:2", loader); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Second)
	got, err := cache.Load(context.Background(), "scope:2", loader)
	if err != nil {
		t.Fatal(err)
	}
	if string(got.Data) != "thumb" {
		t.Fatalf("data=%q", string(got.Data))
	}
	if gotCalls := calls.Load(); gotCalls != 2 {
		t.Fatalf("loader calls=%d want=2", gotCalls)
	}
	if _, err := cache.Load(context.Background(), "scope:2", loader); err != nil {
		t.Fatal(err)
	}
	if gotCalls := calls.Load(); gotCalls != 2 {
		t.Fatalf("fresh revalidated cache called loader again: %d", gotCalls)
	}
}

func TestAgentMediaThumbnailCacheSingleflightsConcurrentMiss(t *testing.T) {
	cache := newAgentMediaThumbnailCache(8, 1<<20)
	start := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int64
	loader := func(etag string) (agentMediaThumbnailFetch, error) {
		if etag != "" {
			t.Fatalf("etag=%q", etag)
		}
		if calls.Add(1) == 1 {
			close(start)
		}
		<-release
		return agentMediaThumbnailFetch{
			Thumbnail: agentMediaThumbnail{ContentType: "image/jpeg", Data: []byte("thumb")},
			ETag:      "\"etag\"",
			MaxAge:    time.Hour,
		}, nil
	}

	const workers = 6
	var wg sync.WaitGroup
	wg.Add(workers)
	errs := make(chan error, workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			got, err := cache.Load(context.Background(), "scope:3", loader)
			if err != nil {
				errs <- err
				return
			}
			if string(got.Data) != "thumb" {
				errs <- fmt.Errorf("data=%q", string(got.Data))
			}
		}()
	}
	<-start
	close(release)
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("loader calls=%d want=1", got)
	}
}

func TestAgentMediaThumbnailCacheEvictsByEntryAndByteBudget(t *testing.T) {
	cache := newAgentMediaThumbnailCache(2, 7)
	cache.now = func() time.Time { return time.Unix(3000, 0) }
	var calls atomic.Int64
	loader := func(value string) func(string) (agentMediaThumbnailFetch, error) {
		return func(string) (agentMediaThumbnailFetch, error) {
			calls.Add(1)
			return agentMediaThumbnailFetch{
				Thumbnail: agentMediaThumbnail{ContentType: "image/jpeg", Data: []byte(value)},
				ETag:      "\"" + value + "\"",
				MaxAge:    time.Hour,
			}, nil
		}
	}

	if _, err := cache.Load(context.Background(), "a", loader("aaaa")); err != nil {
		t.Fatal(err)
	}
	if _, err := cache.Load(context.Background(), "b", loader("bbb")); err != nil {
		t.Fatal(err)
	}
	if _, err := cache.Load(context.Background(), "c", loader("cc")); err != nil {
		t.Fatal(err)
	}
	if len(cache.entries) != 2 || cache.bytes > 7 {
		t.Fatalf("entries=%d bytes=%d", len(cache.entries), cache.bytes)
	}
	if _, ok := cache.entries["a"]; ok {
		t.Fatal("oldest entry was not evicted")
	}
}

func TestFileExplorerDesktopThumbnailWarmAgentCachePerformance(t *testing.T) {
	if os.Getenv("XD_FILEEXPLORER_THUMBNAIL_TRANSPORT_PERF") != "1" {
		t.Skip("set XD_FILEEXPLORER_THUMBNAIL_TRANSPORT_PERF=1 to run the warm thumbnail cache diagnostic")
	}
	const (
		uniqueThumbnails = 200
		passes           = 3
		thumbnailBytes   = 64 << 10
	)
	cache := newAgentMediaThumbnailCache(256, 32<<20)
	cache.now = func() time.Time { return time.Unix(4000, 0) }
	payload := make([]byte, thumbnailBytes)
	var upstreamRequests atomic.Int64
	var payloadBytes atomic.Int64

	started := time.Now()
	for pass := 0; pass < passes; pass++ {
		for id := 1; id <= uniqueThumbnails; id++ {
			key := fmt.Sprintf("benchmark:%d", id)
			got, err := cache.Load(context.Background(), key, func(string) (agentMediaThumbnailFetch, error) {
				upstreamRequests.Add(1)
				payloadBytes.Add(thumbnailBytes)
				return agentMediaThumbnailFetch{
					Thumbnail: agentMediaThumbnail{ContentType: "image/jpeg", Data: payload},
					ETag:      fmt.Sprintf("\"thumb-%d\"", id),
					MaxAge:    time.Hour,
				}, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if len(got.Data) != thumbnailBytes {
				t.Fatalf("thumbnail %d bytes=%d", id, len(got.Data))
			}
		}
	}
	elapsed := time.Since(started)
	if got := upstreamRequests.Load(); got != uniqueThumbnails {
		t.Fatalf("upstream requests=%d want=%d", got, uniqueThumbnails)
	}
	if got := payloadBytes.Load(); got != int64(uniqueThumbnails*thumbnailBytes) {
		t.Fatalf("payload bytes=%d", got)
	}
	fmt.Printf(
		"FILEEXPLORER_DESKTOP_THUMBNAIL_WARM_AGENT_CACHE "+
			"unique=%d passes=%d thumbnail_bytes=%d upstream_requests=%d payload_bytes=%d diagnostic_wall_ms=%.3f\n",
		uniqueThumbnails,
		passes,
		thumbnailBytes,
		upstreamRequests.Load(),
		payloadBytes.Load(),
		float64(elapsed.Microseconds())/1000,
	)
}
