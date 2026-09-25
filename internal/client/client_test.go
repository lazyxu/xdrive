package client

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestDownloadToProgress(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/files/7/content" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Length", "6")
		_, _ = io.WriteString(w, "abcdef")
	}))
	defer ts.Close()

	var out bytes.Buffer
	var progress [][2]int64
	err := New(ts.URL, "").DownloadToProgress(context.Background(), 7, &out, func(done, total int64) {
		progress = append(progress, [2]int64{done, total})
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.String() != "abcdef" {
		t.Fatalf("download=%q", out.String())
	}
	if len(progress) < 2 {
		t.Fatalf("progress callbacks=%v", progress)
	}
	last := progress[len(progress)-1]
	if last != [2]int64{6, 6} {
		t.Fatalf("final progress=%v", last)
	}
}

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

func TestManagedSessionRefreshesWhenAccessTokenIsMemoryOnly(t *testing.T) {
	var refreshCalls int
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/refresh":
			refreshCalls++
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["refresh_token"] != "persisted-refresh" {
				t.Fatalf("refresh token=%q", body["refresh_token"])
			}
			_ = json.NewEncoder(w).Encode(AuthResponse{
				AccessToken: "memory-access", RefreshToken: "rotated-refresh",
				ExpiresIn: 900, RefreshExpiresIn: 3600,
			})
		case "/api/v1/nodes/root":
			if got := r.Header.Get("Authorization"); got != "Bearer memory-access" {
				t.Fatalf("Authorization=%q", got)
			}
			_ = json.NewEncoder(w).Encode(Node{ID: 1, Type: "dir", Revision: 1})
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	var persisted SessionTokens
	c := NewManagedSession(ts.URL, SessionTokens{
		RefreshToken: "persisted-refresh", RefreshExpiresAt: time.Now().Add(time.Hour),
	}, func(tokens SessionTokens) error {
		persisted = tokens
		return nil
	}, nil)

	if _, err := c.Root(context.Background()); err != nil {
		t.Fatal(err)
	}
	if refreshCalls != 1 {
		t.Fatalf("refreshCalls=%d want=1", refreshCalls)
	}
	if persisted.AccessToken != "memory-access" || persisted.RefreshToken != "rotated-refresh" {
		t.Fatalf("persisted callback=%+v", persisted)
	}
}

func TestManagedSessionRecoversCrossProcessRefreshRotation(t *testing.T) {
	var mu sync.Mutex
	activeRefresh := "refresh-new"
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
			current := activeRefresh
			if body["refresh_token"] == current {
				activeRefresh = "refresh-final"
			}
			mu.Unlock()
			if body["refresh_token"] != current {
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

	loadCount := 0
	c := NewManagedSession(ts.URL, SessionTokens{
		RefreshToken: "refresh-old", RefreshExpiresAt: time.Now().Add(time.Hour),
	}, nil, func() (SessionTokens, error) {
		loadCount++
		// First load simulates stale local state. The second load happens after
		// the server rejects the stale token and sees another process's rotation.
		if loadCount == 1 {
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

func TestQuotaUsage(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/me/quota" {
			http.NotFound(w, r)
			return
		}
		if got := r.Header.Get("Authorization"); got != "Bearer token" {
			t.Fatalf("Authorization=%q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"quota_bytes":30,"physical_used_bytes":23,"logical_file_bytes":17,"trash_bytes":0,"history_bytes":6,"over_quota":false}`)
	}))
	defer ts.Close()

	quota, err := New(ts.URL, "token").Quota(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if quota.QuotaBytes != 30 || quota.PhysicalUsedBytes != 23 || quota.LogicalFileBytes != 17 ||
		quota.TrashBytes != 0 || quota.HistoryBytes != 6 || quota.OverQuota {
		t.Fatalf("unexpected quota response: %+v", quota)
	}
}

func TestCloudManagementAPIs(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	var seen []string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/trash":
			_ = json.NewEncoder(w).Encode([]Node{{ID: 7, Name: "old.txt", Type: "file", Revision: 3, DeletedAt: &now}})
		case "/api/v1/trash/7/restore":
			if got := r.Header.Get("If-Match"); got != `"3"` {
				t.Fatalf("restore If-Match=%q", got)
			}
			_ = json.NewEncoder(w).Encode(Node{ID: 7, Name: "old.txt", Type: "file", Revision: 4})
		case "/api/v1/trash/8":
			if got := r.Header.Get("If-Match"); got != `"5"` {
				t.Fatalf("delete If-Match=%q", got)
			}
			w.WriteHeader(http.StatusNoContent)
		case "/api/v1/files/9/versions":
			_ = json.NewEncoder(w).Encode([]FileVersion{{ID: 11, NodeID: 9, Revision: 2, Size: 99, CreatedAt: now}})
		case "/api/v1/files/9/versions/11/restore":
			if got := r.Header.Get("If-Match"); got != `"4"` {
				t.Fatalf("version restore If-Match=%q", got)
			}
			_ = json.NewEncoder(w).Encode(Node{ID: 9, Name: "report.pdf", Type: "file", Revision: 5})
		case "/api/v1/files/9/shares":
			if r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode([]FileShare{{ID: 21, NodeID: 9, Status: "active"}})
				return
			}
			var input CreateShareInput
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Fatal(err)
			}
			if input.Password != "password123" || input.MaxDownloads != 3 || input.ExpiresAt == nil {
				t.Fatalf("share input=%+v", input)
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(CreatedFileShare{
				FileShare: FileShare{ID: 22, NodeID: 9, Status: "active"},
				Token:     "share-token",
			})
		case "/api/v1/shares/22":
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	cli := New(ts.URL, "token")
	ctx := context.Background()
	trash, err := cli.Trash(ctx)
	if err != nil || len(trash) != 1 || trash[0].DeletedAt == nil {
		t.Fatalf("trash=%+v err=%v", trash, err)
	}
	restored, err := cli.RestoreTrash(ctx, 7, 3)
	if err != nil || restored.Revision != 4 {
		t.Fatalf("restore=%+v err=%v", restored, err)
	}
	if err := cli.PermanentlyDeleteTrash(ctx, 8, 5); err != nil {
		t.Fatal(err)
	}
	versions, err := cli.Versions(ctx, 9)
	if err != nil || len(versions) != 1 || versions[0].ID != 11 {
		t.Fatalf("versions=%+v err=%v", versions, err)
	}
	restoredVersion, err := cli.RestoreVersion(ctx, 9, 4, 11)
	if err != nil || restoredVersion.Revision != 5 {
		t.Fatalf("restored version=%+v err=%v", restoredVersion, err)
	}
	expires := now.Add(time.Hour)
	created, err := cli.CreateShare(ctx, 9, CreateShareInput{
		ExpiresAt: &expires, Password: "password123", MaxDownloads: 3,
	})
	if err != nil || created.Token != "share-token" {
		t.Fatalf("created share=%+v err=%v", created, err)
	}
	shares, err := cli.Shares(ctx, 9)
	if err != nil || len(shares) != 1 || shares[0].ID != 21 {
		t.Fatalf("shares=%+v err=%v", shares, err)
	}
	if err := cli.RevokeShare(ctx, 22); err != nil {
		t.Fatal(err)
	}
	if len(seen) != 8 {
		t.Fatalf("requests=%v", seen)
	}
}
