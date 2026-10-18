package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

// SH-P003 is test-only. Unlike SH-P002's independent React and Go tests, its
// first metadata GET originates in the production Web app running in Chromium.
// The fixture holds the actual xd_shares SQL read until browser navigation
// aborts it; 100k are physical PostgreSQL Node metadata, NOT original CAS.
func TestSHP003RealBrowserPublicShare100KFixture(t *testing.T) {
	if os.Getenv("XD_SH_P003_REAL_BROWSER_PERF") != "1" {
		t.Skip("opt-in real browser 100k public-share fixture")
	}
	dist := os.Getenv("XD_SH_P003_WEB_DIST")
	readyFile := os.Getenv("XD_SH_P003_READY_FILE")
	if os.Getenv("XD_TEST_DATABASE_URL") == "" || dist == "" || readyFile == "" {
		t.Fatal("SH-P003 requires PostgreSQL17, built Web dist and ready file")
	}
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		t.Fatalf("real production Web dist unavailable: %v", err)
	}
	router, db, ownerToken, root := folderShareTestFixture(t)
	folder := meta.Node{
		OwnerID: root.OwnerID, ParentID: &root.ID, Name: "shp003-100k-share",
		Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	const entries = 100000
	nodes := make([]meta.Node, entries)
	for i := range nodes {
		nodes[i] = meta.Node{
			OwnerID: root.OwnerID, ParentID: &folder.ID,
			Name: fmt.Sprintf("entry-%06d", i), Type: meta.NodeTypeDir, Revision: 1,
		}
	}
	seedStart := time.Now()
	if err := db.CreateInBatches(nodes, 1000).Error; err != nil {
		t.Fatal(err)
	}
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000
	response := request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/shares", folder.ID), ownerToken,
		strings.NewReader(`{"max_downloads":0}`), http.StatusCreated)
	var share createdShareDTO
	if err := json.Unmarshal(response.Body.Bytes(), &share); err != nil {
		t.Fatal(err)
	}
	if len(share.Token) < 40 {
		t.Fatal("invalid real public share capability")
	}

	lock := db.Begin()
	if lock.Error != nil {
		t.Fatal(lock.Error)
	}
	defer lock.Rollback()
	if err := lock.Exec("LOCK TABLE xd_shares IN ACCESS EXCLUSIVE MODE").Error; err != nil {
		t.Fatal(err)
	}

	type observed struct {
		mu        sync.Mutex
		started   int
		completed int
		cancelled int
		markedAt  time.Time
		handlerMS float64
		unlocked  bool
	}
	state := &observed{}
	waiterCount := func() (int64, error) {
		var n int64
		err := db.Raw(`SELECT COUNT(*) FROM pg_stat_activity
			WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
			  AND query LIKE '%xd_shares%'`).Scan(&n).Error
		return n, err
	}
	stopped := make(chan struct{})
	var stopOnce sync.Once
	files := http.FileServer(http.Dir(dist))
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/__perf/config":
			if r.Method != http.MethodGet {
				http.Error(w, "GET required", http.StatusMethodNotAllowed)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"share_token":            share.Token,
				"directory_id":           folder.ID,
				"metadata_nodes":         entries,
				"physical_cas_originals": 0,
				"seed_ms":                seedMS,
			})
		case "/__perf/state":
			n, err := waiterCount()
			if err != nil {
				http.Error(w, "real PG lock inspection unavailable", http.StatusInternalServerError)
				return
			}
			state.mu.Lock()
			snapshot := map[string]any{
				"started":         state.started,
				"completed":       state.completed,
				"cancelled":       state.cancelled,
				"last_handler_ms": state.handlerMS,
				"sql_waiters":     n,
				"unlocked":        state.unlocked,
			}
			state.mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_ = json.NewEncoder(w).Encode(snapshot)
		case "/__perf/mark":
			if r.Method != http.MethodPost {
				http.Error(w, "POST required", http.StatusMethodNotAllowed)
				return
			}
			state.mu.Lock()
			state.markedAt = time.Now()
			state.mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
		case "/__perf/release-lock":
			if r.Method != http.MethodPost {
				http.Error(w, "POST required", http.StatusMethodNotAllowed)
				return
			}
			state.mu.Lock()
			already := state.unlocked
			state.unlocked = true
			state.mu.Unlock()
			if !already {
				if err := lock.Rollback().Error; err != nil {
					http.Error(w, "cannot release metadata SQL lock", http.StatusInternalServerError)
					return
				}
			}
			w.WriteHeader(http.StatusNoContent)
		case "/__perf/stop":
			if r.Method != http.MethodPost {
				http.Error(w, "POST required", http.StatusMethodNotAllowed)
				return
			}
			stopOnce.Do(func() { close(stopped) })
			w.WriteHeader(http.StatusNoContent)
		default:
			if strings.HasPrefix(r.URL.Path, "/api/") {
				if r.Method == http.MethodGet && r.URL.Path == "/api/v1/public/share" {
					state.mu.Lock()
					state.started++
					state.mu.Unlock()
					router.ServeHTTP(w, r)
					state.mu.Lock()
					state.completed++
					if r.Context().Err() != nil {
						state.cancelled++
						if !state.markedAt.IsZero() {
							state.handlerMS = float64(time.Since(state.markedAt).Microseconds()) / 1000
						}
					}
					state.mu.Unlock()
					return
				}
				router.ServeHTTP(w, r)
				return
			}
			files.ServeHTTP(w, r)
		}
	})
	server := httptest.NewServer(handler)
	defer server.Close()
	if err := os.MkdirAll(filepath.Dir(readyFile), 0700); err != nil {
		t.Fatal(err)
	}
	ready, err := json.Marshal(map[string]any{
		"url":                    server.URL,
		"metadata_nodes":         entries,
		"physical_cas_originals": 0,
		"seed_ms":                seedMS,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Private 0600 readiness records only the ephemeral loopback URL.
	// The temporary bearer is available solely through test-only /__perf/config
	// on this loopback fixture; neither token is logged or archived.
	if err := os.WriteFile(readyFile, ready, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("SH_P003_REAL_BROWSER_READY metadata_nodes=%d physical_CAS=0 seed_ms=%.3f", entries, seedMS)
	select {
	case <-stopped:
		state.mu.Lock()
		t.Logf("SH_P003_REAL_BROWSER_STOP started=%d completed=%d cancelled=%d",
			state.started, state.completed, state.cancelled)
		state.mu.Unlock()
	case <-time.After(18 * time.Minute):
		t.Fatal("real Web/Mobile Web benchmark never requested fixture stop")
	}
}
