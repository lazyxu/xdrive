package api

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestNativeDownloadProgressSamplesBlockedResponseWithoutPerChunkWrites(t *testing.T) {
	server, peer, _, token, _, node := newNativeDownloadProgressFixture(t)
	content := bytes.Repeat([]byte("0123456789abcdef"), 128*1024)
	if _, err := server.Store.Put(t.Context(), "progress/data.txt", bytes.NewReader(content)); err != nil {
		t.Fatal(err)
	}
	if err := server.DB.Model(&meta.File{}).Where("node_id = ?", node.ID).Update("size", len(content)).Error; err != nil {
		t.Fatal(err)
	}
	var updates atomic.Int64
	if err := server.DB.Callback().Update().After("gorm:update").Register("count_native_progress_updates", func(tx *gorm.DB) {
		if tx.Statement.Table == "xd_download_progress" {
			updates.Add(1)
		}
	}); err != nil {
		t.Fatal(err)
	}
	router, peerRouter := server.Router(), peer.Router()
	ticket := nativeProgressTicket(t, router, token, fmt.Sprintf("/api/v1/files/%d/download-ticket", node.ID))
	stream, accepted := startBlockedNativeDownload(t, peerRouter, ticket.URL, "")
	if accepted <= 0 || accepted >= int64(len(content)) {
		t.Fatalf("invalid blocked response fixture: sent=%d size=%d", accepted, len(content))
	}
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	poll := time.NewTicker(50 * time.Millisecond)
	defer poll.Stop()
	for {
		progress := nativeProgressSnapshot(t, router, token, ticket.TransferID)
		if progress.BytesSent > 0 {
			if progress.State != "running" || progress.BytesSent != accepted {
				t.Fatalf("live response counted source reads or completed early: %+v, accepted=%d", progress, accepted)
			}
			break
		}
		select {
		case <-deadline.C:
			t.Fatal("successful response writes were not sampled while the download was blocked")
		case <-poll.C:
		}
	}
	stream.unblock()
	<-stream.done
	progress := nativeProgressSnapshot(t, router, token, ticket.TransferID)
	if progress.State != "completed" || progress.BytesSent != int64(len(content)) {
		t.Fatalf("terminal byte flush=%+v", progress)
	}
	if got := updates.Load(); got < 2 || got > 5 {
		t.Fatalf("2 MiB response performed %d progress updates; expected sampled updates plus final flush, not per-chunk SQL", got)
	}
}

func TestNativeDownloadProgressWaitsForOverlappingRangeResponses(t *testing.T) {
	server, peer, _, token, _, node := newNativeDownloadProgressFixture(t)
	content := bytes.Repeat([]byte("0123456789abcdef"), 8192)
	if _, err := server.Store.Put(t.Context(), "progress/data.txt", bytes.NewReader(content)); err != nil {
		t.Fatal(err)
	}
	if err := server.DB.Model(&meta.File{}).Where("node_id = ?", node.ID).Update("size", len(content)).Error; err != nil {
		t.Fatal(err)
	}
	router, peerRouter := server.Router(), peer.Router()
	ticket := nativeProgressTicket(t, router, token, fmt.Sprintf("/api/v1/files/%d/download-ticket", node.ID))
	first, _ := startBlockedNativeDownload(t, router, ticket.URL, "bytes=0-65535")
	second, _ := startBlockedNativeDownload(t, peerRouter, ticket.URL, "bytes=65536-131071")
	first.unblock()
	<-first.done
	progress := nativeProgressSnapshot(t, router, token, ticket.TransferID)
	if progress.State != "running" {
		t.Fatalf("one range completed the still-running aggregate: %+v", progress)
	}
	second.unblock()
	<-second.done
	progress = nativeProgressSnapshot(t, router, token, ticket.TransferID)
	if progress.State != "completed" || progress.BytesSent != 131072 || progress.BytesTotal != 131072 {
		t.Fatalf("concurrent range response bytes=%+v", progress)
	}
	if first.Code != http.StatusPartialContent || second.Code != http.StatusPartialContent {
		t.Fatalf("range status changed: first=%d second=%d", first.Code, second.Code)
	}
	if !bytes.Equal(first.Body.Bytes(), content[:65536]) || !bytes.Equal(second.Body.Bytes(), content[65536:]) {
		t.Fatal("range payload changed")
	}
}

type blockedNativeDownload struct {
	*httptest.ResponseRecorder
	blocked     chan int64
	release     chan struct{}
	done        chan struct{}
	releaseOnce sync.Once
	writes      int
}

func (w *blockedNativeDownload) Write(p []byte) (int, error) {
	w.writes++
	if w.writes == 2 {
		w.blocked <- int64(w.Body.Len())
		<-w.release
	}
	return w.ResponseRecorder.Write(p)
}

func (w *blockedNativeDownload) unblock() { w.releaseOnce.Do(func() { close(w.release) }) }

func startBlockedNativeDownload(t *testing.T, router http.Handler, url, rangeHeader string) (*blockedNativeDownload, int64) {
	t.Helper()
	stream := &blockedNativeDownload{ResponseRecorder: httptest.NewRecorder(), blocked: make(chan int64, 1), release: make(chan struct{}), done: make(chan struct{})}
	t.Cleanup(func() { stream.unblock(); <-stream.done })
	request := httptest.NewRequest(http.MethodGet, url, nil)
	if rangeHeader != "" {
		request.Header.Set("Range", rangeHeader)
	}
	go func() { defer close(stream.done); router.ServeHTTP(stream, request) }()
	select {
	case accepted := <-stream.blocked:
		return stream, accepted
	case <-stream.done:
		t.Fatalf("download finished before reaching blocked write: code=%d bytes=%d", stream.Code, stream.Body.Len())
	case <-time.After(5 * time.Second):
		t.Fatal("download did not reach its response writer")
	}
	return nil, 0
}
