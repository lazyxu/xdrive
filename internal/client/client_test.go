package client

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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


func TestSessionRefreshBeforeRequest(t *testing.T) {
	var refreshed bool
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/refresh":
			refreshed = true
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["refresh_token"] != "refresh-1" {
				t.Fatalf("refresh token=%q", body["refresh_token"])
			}
			_ = json.NewEncoder(w).Encode(AuthResponse{
				Token: "access-2", AccessToken: "access-2", RefreshToken: "refresh-2",
				ExpiresIn: 900, RefreshExpiresIn: 3600, Username: "alice",
			})
		case "/api/v1/files/9/content":
			if got := r.Header.Get("Authorization"); got != "Bearer access-2" {
				t.Fatalf("Authorization=%q", got)
			}
			w.WriteHeader(http.StatusPartialContent)
			_, _ = io.WriteString(w, "ok")
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	var persisted SessionTokens
	c := NewSession(ts.URL, SessionTokens{
		AccessToken: "access-1", RefreshToken: "refresh-1",
		AccessExpiresAt: time.Now().Add(-time.Minute), RefreshExpiresAt: time.Now().Add(time.Hour),
	}, func(tokens SessionTokens) error {
		persisted = tokens
		return nil
	})
	got, err := c.DownloadRange(context.Background(), 9, 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !refreshed || string(got) != "ok" {
		t.Fatalf("refreshed=%v got=%q", refreshed, got)
	}
	if persisted.AccessToken != "access-2" || persisted.RefreshToken != "refresh-2" {
		t.Fatalf("persisted=%+v", persisted)
	}
}
