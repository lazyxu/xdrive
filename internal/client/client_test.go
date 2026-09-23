package client

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDownloadRangeSendsRangeAndAuth(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer token" {
			t.Errorf("Authorization=%q", got)
		}
		if got := r.Header.Get("Range"); got != "bytes=2-5" {
			t.Errorf("Range=%q", got)
		}
		w.Header().Set("Content-Range", "bytes 2-5/6")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = io.WriteString(w, "cdef")
	}))
	defer ts.Close()

	c := New(ts.URL, "token")
	got, err := c.DownloadRange(context.Background(), 9, 2, 4)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "cdef" {
		t.Fatalf("got %q", got)
	}
}

func TestAPIErrorAndIdentity(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = io.WriteString(w, `{"error":"duplicate"}`)
	}))
	defer ts.Close()

	_, err := New(ts.URL, "").CreateDir(context.Background(), 1, "docs")
	apiErr, ok := err.(*APIError)
	if !ok || apiErr.Status != http.StatusConflict || !strings.Contains(apiErr.Error(), "duplicate") {
		t.Fatalf("unexpected error: %#v", err)
	}

	if id, err := ParseNodeID([]byte(" 123 ")); err != nil || id != 123 {
		t.Fatalf("id=%d err=%v", id, err)
	}
	if _, err := ParseNodeID([]byte("0")); err == nil {
		t.Fatal("zero identity accepted")
	}
}
