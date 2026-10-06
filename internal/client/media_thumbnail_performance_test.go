package client

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestFileExplorerDesktopThumbnailWarmTransportBaseline(t *testing.T) {
	if os.Getenv("XD_FILEEXPLORER_THUMBNAIL_TRANSPORT_PERF") != "1" {
		t.Skip("set XD_FILEEXPLORER_THUMBNAIL_TRANSPORT_PERF=1 to run the thumbnail transport baseline")
	}

	const (
		uniqueThumbnails = 200
		passes           = 3
		thumbnailBytes   = 64 << 10
	)
	payload := bytes.Repeat([]byte{0x5a}, thumbnailBytes)
	var requests atomic.Int64
	var conditionalRequests atomic.Int64
	var payloadBytes atomic.Int64

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		const prefix = "/api/v1/media/items/"
		const suffix = "/thumbnail"
		if r.Method != http.MethodGet || !strings.HasPrefix(r.URL.Path, prefix) || !strings.HasSuffix(r.URL.Path, suffix) {
			http.NotFound(w, r)
			return
		}
		idText := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, prefix), suffix)
		id, err := strconv.ParseUint(strings.Trim(idText, "/"), 10, 64)
		if err != nil || id == 0 || id > uniqueThumbnails {
			http.Error(w, "invalid node id", http.StatusBadRequest)
			return
		}
		requests.Add(1)
		if strings.TrimSpace(r.Header.Get("If-None-Match")) != "" {
			conditionalRequests.Add(1)
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "private, max-age=3600")
		w.Header().Set("ETag", fmt.Sprintf(`"thumb-%d"`, id))
		n, _ := w.Write(payload)
		payloadBytes.Add(int64(n))
	}))
	defer server.Close()

	client := New(server.URL, "benchmark-token")
	started := time.Now()
	for pass := 0; pass < passes; pass++ {
		for id := uint64(1); id <= uniqueThumbnails; id++ {
			data, contentType, err := client.MediaThumbnail(context.Background(), id)
			if err != nil {
				t.Fatal(err)
			}
			if len(data) != thumbnailBytes || contentType != "image/jpeg" {
				t.Fatalf("thumbnail %d bytes=%d content_type=%q", id, len(data), contentType)
			}
		}
	}
	elapsed := time.Since(started)

	const expectedRequests = uniqueThumbnails * passes
	const expectedPayloadBytes = int64(expectedRequests * thumbnailBytes)
	if got := requests.Load(); got != expectedRequests {
		t.Fatalf("requests=%d want=%d", got, expectedRequests)
	}
	if got := conditionalRequests.Load(); got != 0 {
		t.Fatalf("conditional_requests=%d want=0", got)
	}
	if got := payloadBytes.Load(); got != expectedPayloadBytes {
		t.Fatalf("payload_bytes=%d want=%d", got, expectedPayloadBytes)
	}

	fmt.Printf(
		"FILEEXPLORER_DESKTOP_THUMBNAIL_WARM_TRANSPORT_BASELINE "+
			"unique=%d passes=%d thumbnail_bytes=%d requests=%d conditional_requests=%d payload_bytes=%d diagnostic_wall_ms=%.3f\n",
		uniqueThumbnails,
		passes,
		thumbnailBytes,
		requests.Load(),
		conditionalRequests.Load(),
		payloadBytes.Load(),
		float64(elapsed.Microseconds())/1000,
	)
}
