package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

// TestPublicShareMetadataRequestContextCancellation probes the already-existing
// Go/PG cancellation chain for the first GET, independently of the mounted
// React test. It is a real PostgreSQL lock waiter, not a simulated HTTP read.
func TestPublicShareMetadataRequestContextCancellation(t *testing.T) {
	router, db, ownerToken, root := folderShareTestFixture(t)
	shared := meta.Node{
		OwnerID: root.OwnerID, ParentID: &root.ID,
		Name: "cancel-first-metadata", Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := db.Create(&shared).Error; err != nil {
		t.Fatal(err)
	}
	created := request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/shares", shared.ID), ownerToken,
		strings.NewReader(`{"max_downloads":0}`), http.StatusCreated)
	var share createdShareDTO
	if err := json.Unmarshal(created.Body.Bytes(), &share); err != nil {
		t.Fatal(err)
	}
	lock := db.Begin()
	if lock.Error != nil {
		t.Fatal(lock.Error)
	}
	defer lock.Rollback()
	if err := lock.Exec("LOCK TABLE xd_shares IN ACCESS EXCLUSIVE MODE").Error; err != nil {
		t.Fatal(err)
	}
	type point struct {
		Sample       int     `json:"sample"`
		HandlerMS    float64 `json:"handler_ms"`
		SQLReleaseMS float64 `json:"sql_release_ms"`
	}
	results := make([]point, 0, 3)
	for sample := 1; sample <= 3; sample++ {
		ctx, cancel := context.WithCancel(context.Background())
		req := httptest.NewRequest(http.MethodGet, "/api/v1/public/share", nil).WithContext(ctx)
		req.Header.Set("X-XDrive-Share-Token", share.Token)
		response := httptest.NewRecorder()
		done := make(chan struct{})
		go func() {
			defer close(done)
			router.ServeHTTP(response, req)
		}()
		waiterDeadline := time.Now().Add(5 * time.Second)
		observed := false
		for time.Now().Before(waiterDeadline) {
			var waiters int64
			if err := db.Raw(`SELECT COUNT(*) FROM pg_stat_activity
				WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
				AND query LIKE '%xd_shares%'`).Scan(&waiters).Error; err != nil {
				cancel()
				t.Fatal(err)
			}
			if waiters > 0 {
				observed = true
				break
			}
			select {
			case <-done:
				cancel()
				t.Fatal("metadata GET returned before reaching held SQL")
			default:
			}
			time.Sleep(10 * time.Millisecond)
		}
		if !observed {
			cancel()
			t.Fatal("could not observe genuine metadata GET PostgreSQL lock waiter")
		}
		started := time.Now()
		cancel()
		var handlerElapsed time.Duration
		select {
		case <-done:
			handlerElapsed = time.Since(started)
			if handlerElapsed > 160*time.Millisecond {
				t.Fatalf("sample %d: canceled GET handler survived %s", sample, handlerElapsed)
			}
		case <-time.After(160 * time.Millisecond):
			t.Fatalf("sample %d: canceled GET handler exceeded 160ms", sample)
		}
		if response.Code == http.StatusOK {
			t.Fatalf("sample %d: canceled metadata GET returned success", sample)
		}
		deadline := started.Add(160 * time.Millisecond)
		for {
			var remaining int64
			if err := db.Raw(`SELECT COUNT(*) FROM pg_stat_activity
				WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
				AND query LIKE '%xd_shares%'`).Scan(&remaining).Error; err != nil {
				t.Fatal(err)
			}
			if remaining == 0 {
				break
			}
			if !time.Now().Before(deadline) {
				t.Fatalf("sample %d: PostgreSQL lock waiter remains after 160ms", sample)
			}
			time.Sleep(5 * time.Millisecond)
		}
		sqlElapsed := time.Since(started)
		if sqlElapsed > 160*time.Millisecond {
			t.Fatalf("sample %d: SQL waiter released only after %s", sample, sqlElapsed)
		}
		results = append(results, point{
			Sample:       sample,
			HandlerMS:    float64(handlerElapsed.Microseconds()) / 1000,
			SQLReleaseMS: float64(sqlElapsed.Microseconds()) / 1000,
		})
	}
	handler := []float64{results[0].HandlerMS, results[1].HandlerMS, results[2].HandlerMS}
	sort.Float64s(handler)
	record := struct {
		Workload             string  `json:"workload"`
		N                    int     `json:"n"`
		RealPostgreSQL       bool    `json:"real_postgresql"`
		RealBrowser          bool    `json:"real_browser"`
		PhysicalCASOriginals int     `json:"physical_cas_originals"`
		BudgetMS             int     `json:"budget_ms"`
		HandlerP50MS         float64 `json:"handler_p50_ms"`
		Samples              []point `json:"samples"`
	}{"SH-P002/public-share-initial-GET-real-postgresql-cancel", 3, true, false, 0, 160, handler[1], results}
	encoded, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("SH_P002_REAL_POSTGRES_CANCEL %s", encoded)
}
