package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestMediaThumbnailConditionalUsesETagAndCacheControl(t *testing.T) {
	var requests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/api/v1/media/items/7/thumbnail" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("ETag", "\"thumb-7\"")
		w.Header().Set("Cache-Control", "private, max-age=3600")
		if r.Header.Get("If-None-Match") == "\"thumb-7\"" {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("thumbnail"))
	}))
	defer server.Close()

	cli := New(server.URL, "test-token")
	first, err := cli.MediaThumbnailConditional(context.Background(), 7, "")
	if err != nil {
		t.Fatal(err)
	}
	if first.NotModified || string(first.Data) != "thumbnail" ||
		first.ContentType != "image/jpeg" || first.ETag != "\"thumb-7\"" ||
		first.MaxAge != time.Hour {
		t.Fatalf("first response=%+v", first)
	}

	second, err := cli.MediaThumbnailConditional(context.Background(), 7, first.ETag)
	if err != nil {
		t.Fatal(err)
	}
	if !second.NotModified || len(second.Data) != 0 ||
		second.ETag != "\"thumb-7\"" || second.MaxAge != time.Hour {
		t.Fatalf("second response=%+v", second)
	}
	if got := requests.Load(); got != 2 {
		t.Fatalf("requests=%d want=2", got)
	}
}

func TestMediaThumbnailPreservesLegacyUnconditionalContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/webp")
		w.Header().Set("Cache-Control", "private, max-age=60")
		_, _ = w.Write([]byte("legacy"))
	}))
	defer server.Close()

	cli := New(server.URL, "test-token")
	data, contentType, err := cli.MediaThumbnail(context.Background(), 9)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "legacy" || contentType != "image/webp" {
		t.Fatalf("data=%q content_type=%q", string(data), contentType)
	}
}
