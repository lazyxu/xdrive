package client

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestManagedSessionWaitsForCrossProcessRefreshPersistence(t *testing.T) {
	var mu sync.Mutex
	refreshCalls := []string{}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/refresh":
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			mu.Lock()
			refreshCalls = append(refreshCalls, body["refresh_token"])
			mu.Unlock()
			if body["refresh_token"] != "refresh-new" {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = io.WriteString(w, `{"error":"invalid or expired refresh token"}`)
				return
			}
			_ = json.NewEncoder(w).Encode(AuthResponse{
				AccessToken: "access-final", RefreshToken: "refresh-final",
				ExpiresIn: 900, RefreshExpiresIn: 3600,
			})
		case "/api/v1/nodes/root":
			if got := r.Header.Get("Authorization"); got != "Bearer access-final" {
				t.Fatalf("Authorization=%q", got)
			}
			_ = json.NewEncoder(w).Encode(Node{ID: 1, Type: "dir", Revision: 1})
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	var loadMu sync.Mutex
	loadCount := 0
	c := NewManagedSession(ts.URL, SessionTokens{
		RefreshToken: "refresh-old", RefreshExpiresAt: time.Now().Add(time.Hour),
	}, nil, func() (SessionTokens, error) {
		loadMu.Lock()
		defer loadMu.Unlock()
		loadCount++
		// RefreshSession performs one preflight read and one immediate reload
		// after the 401. Simulate the winning process persisting its rotated
		// credential only after both of those reads have still seen stale data.
		if loadCount <= 3 {
			return SessionTokens{RefreshToken: "refresh-old", RefreshExpiresAt: time.Now().Add(time.Hour)}, nil
		}
		return SessionTokens{RefreshToken: "refresh-new", RefreshExpiresAt: time.Now().Add(time.Hour)}, nil
	})

	if _, err := c.Root(context.Background()); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	gotCalls := append([]string(nil), refreshCalls...)
	mu.Unlock()
	if len(gotCalls) != 2 || gotCalls[0] != "refresh-old" || gotCalls[1] != "refresh-new" {
		t.Fatalf("refresh calls=%v", gotCalls)
	}
}

func TestManagedSessionReloadsRotatedTokenBeforeExpiredFailure(t *testing.T) {
	refreshCalls := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/refresh":
			refreshCalls++
			http.Error(w, "unexpected refresh", http.StatusInternalServerError)
		case "/api/v1/nodes/root":
			if got := r.Header.Get("Authorization"); got != "Bearer access-new" {
				t.Fatalf("Authorization=%q", got)
			}
			_ = json.NewEncoder(w).Encode(Node{ID: 1, Type: "dir", Revision: 1})
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	c := NewManagedSession(ts.URL, SessionTokens{
		AccessToken: "access-old", RefreshToken: "refresh-old",
		AccessExpiresAt:  time.Now().Add(time.Hour),
		RefreshExpiresAt: time.Now().Add(-time.Minute),
	}, nil, func() (SessionTokens, error) {
		return SessionTokens{
			AccessToken: "access-new", RefreshToken: "refresh-new",
			AccessExpiresAt:  time.Now().Add(time.Hour),
			RefreshExpiresAt: time.Now().Add(time.Hour),
		}, nil
	})

	if _, err := c.Root(context.Background()); err != nil {
		t.Fatal(err)
	}
	if refreshCalls != 0 {
		t.Fatalf("refreshCalls=%d want=0", refreshCalls)
	}
}
