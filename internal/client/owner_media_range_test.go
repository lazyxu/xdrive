package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

// This is an httptest Server implementing the same Range + ETag contract as
// the xDrive Server's http.ServeContent. It exercises bytes, not just a schema.
func TestDownloadVerifiedRangeRejectsIgnoredOrCorruptedRanges(t *testing.T) {
	for _, tc := range []struct {
		name    string
		status  int
		etag    string
		content string
		body    string
		wantErr bool
	}{
		{"valid", 206, "\"7\"", "bytes 4-7/10", "4567", false},
		{"range ignored", 200, "\"7\"", "", "0123456789", true},
		{"revision changed", 206, "\"8\"", "bytes 4-7/10", "4567", true},
		{"weak etag", 206, "W/\"7\"", "bytes 4-7/10", "4567", true},
		{"missing SHA", 206, "\"7\"", "bytes 4-7/10", "4567", true},
		{"wrong start", 206, "\"7\"", "bytes 0-3/10", "0123", true},
		{"wrong end", 206, "\"7\"", "bytes 4-8/10", "45678", true},
		{"bad total", 206, "\"7\"", "bytes 4-7/7", "4567", true},
		{"missing total", 206, "\"7\"", "bytes 4-7/*", "4567", true},
		{"noncanonical range", 206, "\"7\"", "bytes 04-07/10", "4567", true},
		{"bad body", 206, "\"7\"", "bytes 4-7/10", "456", true},
		{"oversized body", 206, "\"7\"", "bytes 4-7/10", "45678", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			hits := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hits++
				if r.Method != http.MethodGet || r.URL.Path != "/api/v1/files/42/content" ||
					r.Header.Get("Range") != "bytes=4-7" ||
					r.Header.Get("If-Range") != "\"7\"" ||
					r.Header.Get("Authorization") != "Bearer secure" {
					t.Errorf("invalid authenticated request: %v", r)
				}
				if tc.etag != "" {
					w.Header().Set("ETag", tc.etag)
				}
				if tc.name != "missing SHA" {
					w.Header().Set("X-Content-SHA256", strings.Repeat("a", 64))
				}
				if tc.content != "" {
					w.Header().Set("Content-Range", tc.content)
				}
				// Content-Length is validated against the requested Content-Range.
				w.Header().Set("Content-Length", strconv.Itoa(len(tc.body)))
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			api := &Client{BaseURL: server.URL, Token: "secure", HTTP: server.Client()}
			got, err := api.DownloadVerifiedRange(context.Background(), 42, 7, 4, 4)
			if (err != nil) != tc.wantErr {
				t.Fatalf("range err=%v expectedErr=%v", err, tc.wantErr)
			}
			if !tc.wantErr && (got.Offset != 4 || got.Total != 10 || got.Revision != 7 ||
				string(got.Data) != "4567") {
				t.Fatalf("unverified data returned: %+v", got)
			}
			if hits != 1 {
				t.Fatalf("expected one Server Owner range request, got %d", hits)
			}
		})
	}
}

func TestDownloadVerifiedRangeRejectsSelectorsBeforeRequest(t *testing.T) {
	hits := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		http.Error(w, "unexpected request", 500)
	}))
	defer server.Close()
	api := &Client{BaseURL: server.URL, Token: "secure", HTTP: server.Client()}
	for _, param := range []struct {
		id, revision uint64
		offset       int64
		length       int
	}{
		{0, 1, 0, 1}, {42, 0, 0, 1}, {42, 7, -1, 1},
		{42, 7, 0, 0}, {42, 7, 0, OwnerMediaRangeMaxBytes + 1},
	} {
		if _, err := api.DownloadVerifiedRange(context.Background(),
			param.id, param.revision, param.offset, param.length); err == nil {
			t.Fatalf("invalid selector admitted: %+v", param)
		}
	}
	if hits != 0 {
		t.Fatalf("invalid selector made %d upstream calls", hits)
	}
}
